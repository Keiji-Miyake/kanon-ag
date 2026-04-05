#!/usr/bin/env node
/**
 * Agent Spawner — 並列エージェントプロセス管理
 *
 * CLI子プロセスとしてエージェントを起動し、PID管理・タイムアウト・リトライを行う。
 * memory-manager と cli-resolver を使用して状態管理とコマンド構築を統合。
 */
import { spawn } from 'child_process';
export const DEFAULT_SPAWN_CONFIG = {
    maxParallel: 3,
    pollIntervalMs: 1000,
    retryDelaysMs: [30000, 60000],
    retryConfig: { maxRetries: 2, initialDelayMs: 30000, backoffFactor: 2.0 },
    timeoutMs: 600000, // 10分
    idleTimeoutMs: 300000, // 5分（何も出力がない場合）
};
/**
 * retryConfig から遅延配列を構築するユーティリティ
 */
function computeRetryDelays(config) {
    if (Array.isArray(config.retryDelaysMs) && config.retryDelaysMs.length > 0)
        return config.retryDelaysMs;
    const rc = config.retryConfig || DEFAULT_SPAWN_CONFIG.retryConfig;
    if (!rc)
        return DEFAULT_SPAWN_CONFIG.retryDelaysMs || [];
    const delays = [];
    for (let i = 0; i < rc.maxRetries; i++) {
        delays.push(Math.round(rc.initialDelayMs * Math.pow(rc.backoffFactor, i)));
    }
    return delays;
}
// ─── Agent Registry ─────────────────────────────────────────
const agentRegistry = new Map();
function registryKey(sessionId, skill) {
    return `${sessionId}::${skill}`;
}
// ─── Core Functions ─────────────────────────────────────────
export function spawnAgent(skill, command, sessionId, cliName = 'gemini', workspace = process.cwd(), onLog, stdinData) {
    const key = registryKey(sessionId, skill);
    const existing = agentRegistry.get(key);
    if (existing && existing.status === 'running') {
        throw new Error(`エージェント "${skill}" は既に実行中 (PID: ${existing.pid})`);
    }
    let child;
    let commandStr;
    const env = {
        ...process.env,
        AGENT_SKILL: skill,
        AGENT_SESSION: sessionId,
        NODE_OPTIONS: '--no-deprecation',
        NODE_NO_WARNINGS: '1',
        KANON_MEMORIES_BASE: process.env.KANON_MEMORIES_BASE || process.cwd()
    };
    if (typeof command === 'string') {
        commandStr = command;
        child = spawn('sh', ['-c', command], {
            cwd: workspace,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });
    }
    else {
        commandStr = [command.cmd, ...command.args].join(' ');
        child = spawn(command.cmd, command.args, {
            cwd: workspace,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });
    }
    if (stdinData && child.stdin) {
        child.stdin.write(stdinData);
        child.stdin.end();
    }
    let resolvePromise;
    const promise = new Promise(resolve => {
        resolvePromise = resolve;
    });
    const agent = {
        skill,
        cli: cliName,
        pid: child.pid || 0,
        startedAt: Date.now(),
        lastOutputAt: Date.now(),
        command: commandStr,
        status: 'running',
        exitCode: null,
        retryCount: 0,
        stdout: '',
        stderr: '',
        promise,
    };
    if (agent.pid === 0) {
        agent.status = 'failed';
        agent.stderr = 'Failed to get PID';
        resolvePromise(null);
    }
    const updateOutput = (text, isError) => {
        agent.lastOutputAt = Date.now(); // 出力があったので更新
        if (isError) {
            agent.stderr += text;
            if (agent.stderr.length > 10485760)
                agent.stderr = agent.stderr.slice(-10485760);
        }
        else {
            agent.stdout += text;
            if (agent.stdout.length > 10485760)
                agent.stdout = agent.stdout.slice(-10485760);
        }
        if (onLog) {
            text.split('\n').forEach(line => {
                if (line.trim())
                    onLog(line.trim(), isError);
            });
        }
    };
    child.stdout?.on('data', (data) => updateOutput(data.toString(), false));
    child.stderr?.on('data', (data) => updateOutput(data.toString(), true));
    child.on('close', (code) => {
        agent.exitCode = code;
        agent.status = code === 0 ? 'completed' : 'failed';
        resolvePromise(code);
    });
    child.on('error', (err) => {
        agent.status = 'failed';
        agent.stderr += `\nspawn error: ${err.message}`;
        resolvePromise(null);
    });
    agentRegistry.set(key, agent);
    return agent;
}
export function getAgentStatus(sessionId, skill) {
    return agentRegistry.get(registryKey(sessionId, skill)) || null;
}
export function getAllAgentStatuses(sessionId) {
    const results = [];
    for (const [key, agent] of agentRegistry) {
        if (key.startsWith(`${sessionId}::`)) {
            results.push(agent);
        }
    }
    return results;
}
export function killAgent(sessionId, skill) {
    const agent = agentRegistry.get(registryKey(sessionId, skill));
    if (!agent || agent.status !== 'running')
        return false;
    try {
        process.kill(-agent.pid, 'SIGTERM');
        agent.status = 'killed';
        agent.exitCode = -1;
        return true;
    }
    catch {
        try {
            process.kill(agent.pid, 'SIGTERM');
            agent.status = 'killed';
            agent.exitCode = -1;
            return true;
        }
        catch {
            return false;
        }
    }
}
export function countRunningAgents(sessionId) {
    return getAllAgentStatuses(sessionId).filter(a => a.status === 'running').length;
}
/**
 * タイムアウトチェック
 */
export function checkTimeout(agent, config) {
    if (agent.status !== 'running')
        return 'none';
    const now = Date.now();
    const elapsedIdle = now - agent.lastOutputAt;
    // 合計タイムアウト
    if (config.timeoutMs > 0 && (now - agent.startedAt) > config.timeoutMs) {
        return 'total';
    }
    // 無通信タイムアウト
    if (config.idleTimeoutMs && config.idleTimeoutMs > 0 && elapsedIdle > config.idleTimeoutMs) {
        return 'idle';
    }
    return 'none';
}
export async function executeBatch(tasks, sessionId, config = DEFAULT_SPAWN_CONFIG, workspace = process.cwd(), onProgress) {
    const results = [];
    const pending = new Set(tasks.map(t => t.skill));
    const completed = new Set();
    const failed = new Set();
    const retryCountMap = new Map();
    const retryDelays = computeRetryDelays(config);
    while (pending.size > 0) {
        const ready = tasks.filter(t => pending.has(t.skill)
            && !agentRegistry.has(registryKey(sessionId, t.skill))
            && (t.dependsOn || []).every(dep => completed.has(dep)));
        const running = countRunningAgents(sessionId);
        const canStart = Math.max(0, config.maxParallel - running);
        const toStart = ready.slice(0, canStart);
        for (const task of toStart) {
            const agent = spawnAgent(task.skill, task.command, sessionId, task.cliName, workspace);
            agent.retryCount = retryCountMap.get(task.skill) || 0;
            onProgress?.(agent);
        }
        await sleep(config.pollIntervalMs);
        for (const task of tasks) {
            if (!pending.has(task.skill))
                continue;
            const agent = getAgentStatus(sessionId, task.skill);
            if (!agent)
                continue;
            const timeoutStatus = checkTimeout(agent, config);
            if (timeoutStatus !== 'none') {
                killAgent(sessionId, task.skill);
                agent.status = timeoutStatus === 'total' ? 'timeout' : 'idle_timeout';
                agent.stderr += `\n[System] ${timeoutStatus === 'total' ? 'Total' : 'Idle'} timeout exceeded.`;
            }
            if (agent.status !== 'running') {
                if (agent.status === 'completed') {
                    completed.add(task.skill);
                    pending.delete(task.skill);
                    results.push(toResult(agent));
                    onProgress?.(agent);
                }
                else {
                    // 特定のエラー（429等）は常にリトライするなどの拡張が可能
                    const isRateLimit = agent.stderr.includes('429') || agent.stderr.includes('RESOURCE_EXHAUSTED');
                    const retries = retryCountMap.get(task.skill) || 0;
                    if (retries < retryDelays.length || (isRateLimit && retries < 5)) {
                        const baseDelay = retryDelays[Math.min(retries, retryDelays.length - 1)];
                        // 429 の場合は少し長めに待つ
                        const delay = isRateLimit ? Math.max(baseDelay, 60000) : baseDelay;
                        retryCountMap.set(task.skill, retries + 1);
                        agentRegistry.delete(registryKey(sessionId, task.skill));
                        await sleep(delay);
                    }
                    else {
                        failed.add(task.skill);
                        pending.delete(task.skill);
                        results.push(toResult(agent));
                        onProgress?.(agent);
                    }
                }
            }
        }
        for (const task of tasks) {
            if (!pending.has(task.skill))
                continue;
            const deps = task.dependsOn || [];
            if (deps.some(dep => failed.has(dep))) {
                pending.delete(task.skill);
                failed.add(task.skill);
                results.push({
                    skill: task.skill,
                    success: false,
                    exitCode: null,
                    durationMs: 0,
                    retryCount: 0,
                    stdout: '',
                    stderr: `Skipped due to dependency failure: ${deps.filter(d => failed.has(d)).join(', ')}`,
                });
            }
        }
    }
    return results;
}
function toResult(agent) {
    return {
        skill: agent.skill,
        success: agent.status === 'completed',
        exitCode: agent.exitCode,
        durationMs: Date.now() - agent.startedAt,
        retryCount: agent.retryCount,
        stdout: agent.stdout,
        stderr: agent.stderr,
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function cleanupSession(sessionId) {
    for (const [key, agent] of agentRegistry) {
        if (key.startsWith(`${sessionId}::`)) {
            if (agent.status === 'running') {
                try {
                    process.kill(-agent.pid, 'SIGTERM');
                }
                catch {
                    try {
                        process.kill(agent.pid, 'SIGTERM');
                    }
                    catch { /* ignore */ }
                }
            }
            agentRegistry.delete(key);
        }
    }
}
export function clearRegistry() {
    agentRegistry.clear();
}
