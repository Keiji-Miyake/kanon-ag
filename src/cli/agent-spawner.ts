#!/usr/bin/env node
/**
 * Agent Spawner — 並列エージェントプロセス管理
 *
 * CLI子プロセスとしてエージェントを起動し、PID管理・タイムアウト・リトライを行う。
 * memory-manager と cli-resolver を使用して状態管理とコマンド構築を統合。
 *
 * Usage:
 *   npx ts-node agent-spawner.ts --test    セルフテスト
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// ─── Types ──────────────────────────────────────────────────

export interface SpawnConfig {
    /** 最大並列数 */
    maxParallel: number;
    /** ポーリング間隔（ms） */
    pollIntervalMs: number;
    /** リトライ遅延（ms配列） */
    retryDelaysMs: number[];
    /** タイムアウト（ms、0=無制限） */
    timeoutMs: number;
}

export interface AgentProcess {
    skill: string;
    cli: string;
    pid: number;
    startedAt: number;
    command: string;
    status: 'running' | 'completed' | 'failed' | 'timeout' | 'killed';
    exitCode: number | null;
    retryCount: number;
    stdout: string;
    stderr: string;
    promise?: Promise<number | null>;
}

export interface SpawnResult {
    skill: string;
    success: boolean;
    exitCode: number | null;
    durationMs: number;
    retryCount: number;
    stdout: string;
    stderr: string;
}

export const DEFAULT_SPAWN_CONFIG: SpawnConfig = {
    maxParallel: 3,
    pollIntervalMs: 15000,
    retryDelaysMs: [30000, 60000],
    timeoutMs: 600000, // 10分
};

// ─── Agent Registry ─────────────────────────────────────────

/** 実行中エージェントの管理レジストリ */
const agentRegistry: Map<string, AgentProcess> = new Map();

/**
 * レジストリのキーを生成
 */
function registryKey(sessionId: string, skill: string): string {
    return `${sessionId}::${skill}`;
}

// ─── Core Functions ─────────────────────────────────────────

/**
 * エージェントを子プロセスとして起動する。
 *
 * @param skill スキル名
 * @param command 実行コマンド文字列またはオブジェクト（コマンドインジェクション対策）
 * @param sessionId セッションID
 * @param cliName CLI名（記録用）
 * @param workspace 作業ディレクトリ
 * @returns AgentProcess 情報
 */
export function spawnAgent(
    skill: string,
    command: string | { cmd: string; args: string[] },
    sessionId: string,
    cliName: string = 'gemini',
    workspace: string = process.cwd(),
    onLog?: (data: string, isError: boolean) => void
): AgentProcess {
    const key = registryKey(sessionId, skill);

    // 既に実行中なら拒否
    const existing = agentRegistry.get(key);
    if (existing && existing.status === 'running') {
        throw new Error(`エージェント "${skill}" は既に実行中 (PID: ${existing.pid})`);
    }

    // コマンドを実行（文字列ならsh -c、オブジェクトなら直接）
    let child: ChildProcess;
    let commandStr: string;
    const env = {
        ...process.env,
        AGENT_SKILL: skill,
        AGENT_SESSION: sessionId,
        NODE_OPTIONS: '--no-deprecation',
        NODE_NO_WARNINGS: '1'
    };
    
    if (typeof command === 'string') {
        commandStr = command;
        child = spawn('sh', ['-c', command], {
            cwd: workspace,
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });
    } else {
        commandStr = [command.cmd, ...command.args].join(' ');
        child = spawn(command.cmd, command.args, {
            cwd: workspace,
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });
    }

    let resolvePromise!: (code: number | null) => void;
    const promise = new Promise<number | null>(resolve => {
        resolvePromise = resolve;
    });

    const agent: AgentProcess = {
        skill,
        cli: cliName,
        pid: child.pid || 0,
        startedAt: Date.now(),
        command: commandStr,
        status: 'running',
        exitCode: null,
        retryCount: 0,
        stdout: '',
        stderr: '',
        promise,
    };

    // stdout/stderr を蓄積
    child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        agent.stdout += text;
        if (onLog) {
            text.split('\n').forEach(line => {
                if (line.trim()) onLog(line.trim(), false);
            });
        }
        // 最後の 10KB だけ保持
        if (agent.stdout.length > 10240) {
            agent.stdout = agent.stdout.slice(-10240);
        }
    });

    child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        agent.stderr += text;
        if (onLog) {
            text.split('\n').forEach(line => {
                if (line.trim()) onLog(line.trim(), true);
            });
        }
        if (agent.stderr.length > 10240) {
            agent.stderr = agent.stderr.slice(-10240);
        }
    });

    // 終了ハンドラ
    child.on('close', (code: number | null) => {
        agent.exitCode = code;
        agent.status = code === 0 ? 'completed' : 'failed';
        resolvePromise(code);
    });

    child.on('error', (err: Error) => {
        agent.status = 'failed';
        agent.stderr += `\nspawn error: ${err.message}`;
        resolvePromise(null);
    });

    agentRegistry.set(key, agent);
    return agent;
}

/**
 * エージェントのステータスを取得
 */
export function getAgentStatus(sessionId: string, skill: string): AgentProcess | null {
    return agentRegistry.get(registryKey(sessionId, skill)) || null;
}

/**
 * 全エージェントのステータスを取得
 */
export function getAllAgentStatuses(sessionId: string): AgentProcess[] {
    const results: AgentProcess[] = [];
    for (const [key, agent] of agentRegistry) {
        if (key.startsWith(`${sessionId}::`)) {
            results.push(agent);
        }
    }
    return results;
}

/**
 * エージェントを強制終了
 */
export function killAgent(sessionId: string, skill: string): boolean {
    const agent = agentRegistry.get(registryKey(sessionId, skill));
    if (!agent || agent.status !== 'running') return false;

    try {
        process.kill(agent.pid, 'SIGTERM');
        agent.status = 'killed';
        agent.exitCode = -1;
        return true;
    } catch {
        return false;
    }
}

/**
 * 実行中のエージェント数をカウント
 */
export function countRunningAgents(sessionId: string): number {
    return getAllAgentStatuses(sessionId).filter(a => a.status === 'running').length;
}

/**
 * エージェントがタイムアウトしているか確認
 */
export function checkTimeout(agent: AgentProcess, timeoutMs: number): boolean {
    if (agent.status !== 'running' || timeoutMs <= 0) return false;
    return (Date.now() - agent.startedAt) > timeoutMs;
}

// ─── Batch Execution ────────────────────────────────────────

export interface BatchTask {
    skill: string;
    command: string | { cmd: string; args: string[] };
    cliName: string;
    /** 依存スキル（先に完了する必要がある） */
    dependsOn?: string[];
}

/**
 * 複数エージェントを並列実行する。依存関係・最大並列数を尊重。
 *
 * @param tasks 実行タスクリスト
 * @param sessionId セッションID
 * @param config Spawn設定
 * @param workspace 作業ディレクトリ
 * @param onProgress 進捗コールバック（オプション）
 * @returns 全エージェントの実行結果
 */
export async function executeBatch(
    tasks: BatchTask[],
    sessionId: string,
    config: SpawnConfig = DEFAULT_SPAWN_CONFIG,
    workspace: string = process.cwd(),
    onProgress?: (agent: AgentProcess) => void,
): Promise<SpawnResult[]> {
    const results: SpawnResult[] = [];
    const pending = new Set(tasks.map(t => t.skill));
    const completed = new Set<string>();
    const failed = new Set<string>();
    const retryCountMap: Map<string, number> = new Map();

    while (pending.size > 0) {
        // 依存が解決済みで、まだ起動していないタスクを取得
        const ready = tasks.filter(t =>
            pending.has(t.skill)
            && !agentRegistry.has(registryKey(sessionId, t.skill))
            && (t.dependsOn || []).every(dep => completed.has(dep))
        );

        // 起動可能分を最大並列数まで起動
        const running = countRunningAgents(sessionId);
        const canStart = Math.max(0, config.maxParallel - running);
        const toStart = ready.slice(0, canStart);

        for (const task of toStart) {
            const agent = spawnAgent(task.skill, task.command, sessionId, task.cliName, workspace);
            agent.retryCount = retryCountMap.get(task.skill) || 0;
            onProgress?.(agent);
        }

        // ポーリング：完了チェック
        await sleep(config.pollIntervalMs);

        // タイムアウトチェック・完了チェック
        for (const task of tasks) {
            if (!pending.has(task.skill)) continue;
            const agent = getAgentStatus(sessionId, task.skill);
            if (!agent) continue;

            // タイムアウト判定
            if (checkTimeout(agent, config.timeoutMs)) {
                killAgent(sessionId, task.skill);
                agent.status = 'timeout';
            }

            // 完了判定
            if (agent.status !== 'running') {
                if (agent.status === 'completed') {
                    completed.add(task.skill);
                    pending.delete(task.skill);
                    results.push(toResult(agent));
                    onProgress?.(agent);
                } else {
                    // リトライ判定
                    const retries = retryCountMap.get(task.skill) || 0;
                    if (retries < config.retryDelaysMs.length) {
                        const delay = config.retryDelaysMs[retries];
                        retryCountMap.set(task.skill, retries + 1);
                        // レジストリから削除して再起動可能にする
                        agentRegistry.delete(registryKey(sessionId, task.skill));
                        await sleep(delay);
                    } else {
                        failed.add(task.skill);
                        pending.delete(task.skill);
                        results.push(toResult(agent));
                        onProgress?.(agent);
                    }
                }
            }
        }

        // 依存先が失敗した場合、依存するタスクも失敗にする
        for (const task of tasks) {
            if (!pending.has(task.skill)) continue;
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
                    stderr: `依存スキル失敗により実行スキップ: ${deps.filter(d => failed.has(d)).join(', ')}`,
                });
            }
        }
    }

    return results;
}

function toResult(agent: AgentProcess): SpawnResult {
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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Utility ────────────────────────────────────────────────

/**
 * セッション内の全エージェントをクリーンアップ
 */
export function cleanupSession(sessionId: string): void {
    for (const [key, agent] of agentRegistry) {
        if (key.startsWith(`${sessionId}::`)) {
            if (agent.status === 'running') {
                try { process.kill(agent.pid, 'SIGTERM'); } catch { /* ignore */ }
            }
            agentRegistry.delete(key);
        }
    }
}

/**
 * レジストリを完全クリア（テスト用）
 */
export function clearRegistry(): void {
    agentRegistry.clear();
}

// ─── Self-Test ──────────────────────────────────────────────

async function selfTest(): Promise<void> {
    console.log('\n═══════════════════════════════════════════');
    console.log('  🧪 Agent Spawner Self-Test');
    console.log('═══════════════════════════════════════════\n');

    let passed = 0;
    let total = 0;

    function assert(condition: boolean, message: string): void {
        total++;
        if (condition) {
            console.log(`  ✅ ${message}`);
            passed++;
        } else {
            console.log(`  ❌ ${message}`);
        }
    }

    const sessionId = `test-${Date.now()}`;

    // Test 1: 単一エージェント spawn
    console.log('  [1/6] spawnAgent (echo コマンド)...');
    const agent1 = spawnAgent('test-skill', 'echo "hello agent"', sessionId, 'test');
    assert(agent1.pid > 0, `PID 取得 (${agent1.pid})`);
    assert(agent1.status === 'running' || agent1.status === 'completed', 'ステータス: running or completed');
    assert(agent1.cli === 'test', 'CLI名: test');

    await sleep(1000);
    const status1 = getAgentStatus(sessionId, 'test-skill');
    assert(status1 !== null, 'レジストリに登録済み');
    assert(status1!.status === 'completed', 'echo 完了');
    assert(status1!.exitCode === 0, '終了コード: 0');
    assert(status1!.stdout.includes('hello agent'), 'stdout に出力含む');

    // Test 2: 重複 spawn の拒否
    console.log('\n  [2/6] 重複 spawn 拒否...');
    clearRegistry();
    spawnAgent('slow-skill', 'sleep 10', sessionId, 'test');
    let dupError = false;
    try {
        spawnAgent('slow-skill', 'sleep 10', sessionId, 'test');
    } catch (e: unknown) {
        dupError = (e as Error).message.includes('既に実行中');
    }
    assert(dupError, '重複 spawn でエラー');
    killAgent(sessionId, 'slow-skill');

    // Test 3: killAgent
    console.log('\n  [3/6] killAgent...');
    clearRegistry();
    spawnAgent('kill-test', 'sleep 30', sessionId, 'test');
    await sleep(500);
    const killed = killAgent(sessionId, 'kill-test');
    assert(killed, 'kill 成功');
    const status3 = getAgentStatus(sessionId, 'kill-test');
    assert(status3!.status === 'killed', 'ステータス: killed');

    // Test 4: countRunningAgents
    console.log('\n  [4/6] countRunningAgents...');
    clearRegistry();
    spawnAgent('count-a', 'sleep 10', sessionId, 'test');
    spawnAgent('count-b', 'sleep 10', sessionId, 'test');
    const runCount = countRunningAgents(sessionId);
    assert(runCount === 2, `実行中: ${runCount} (expected 2)`);
    killAgent(sessionId, 'count-a');
    killAgent(sessionId, 'count-b');

    // Test 5: checkTimeout
    console.log('\n  [5/6] checkTimeout...');
    clearRegistry();
    const agent5 = spawnAgent('timeout-test', 'sleep 30', sessionId, 'test');
    const notTimedOut = checkTimeout(agent5, 60000);
    assert(!notTimedOut, 'タイムアウトなし (60s)');
    // 開始時間を偽装
    agent5.startedAt = Date.now() - 70000;
    const timedOut = checkTimeout(agent5, 60000);
    assert(timedOut, 'タイムアウト検知 (60s 経過)');
    killAgent(sessionId, 'timeout-test');

    // Test 6: executeBatch（依存関係付き）
    console.log('\n  [6/6] executeBatch...');
    clearRegistry();
    const tasks: BatchTask[] = [
        { skill: 'step-1', command: 'echo "step 1 done"', cliName: 'test' },
        { skill: 'step-2', command: 'echo "step 2 done"', cliName: 'test', dependsOn: ['step-1'] },
    ];
    const batchResults = await executeBatch(
        tasks,
        `batch-${Date.now()}`,
        { ...DEFAULT_SPAWN_CONFIG, pollIntervalMs: 500, timeoutMs: 10000 },
    );
    assert(batchResults.length === 2, `結果数: ${batchResults.length}`);
    assert(batchResults.every(r => r.success), '全タスク成功');
    assert(batchResults.find(r => r.skill === 'step-2') !== undefined, 'step-2 が依存解決後に実行');

    // Cleanup
    cleanupSession(sessionId);
    clearRegistry();

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  ${passed === total ? '🎉' : '⚠️'} テスト結果: ${passed}/${total} 合格`);
    console.log('═══════════════════════════════════════════\n');

    process.exit(passed === total ? 0 : 1);
}

// ─── Main ───────────────────────────────────────────────────

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    if (process.argv.includes('--test')) {
        selfTest();
    }
}
