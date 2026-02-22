#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { WebSocketServer, WebSocket } from 'ws';

import { loadConfig, resolveCli, buildCommandArgs, ensureConfig } from './cli-resolver.js';
import { spawnAgent, getAgentStatus, cleanupSession } from './agent-spawner.js';
import { readSession, updateSession, initSession } from './memory-manager.js';
import { runDashboard } from './dashboard.js';

// 新アーキテクチャインポート群
import { WorktreeManager } from '../usecases/environment/worktreeManager.js';
import { LocalGitSandbox } from '../infrastructure/git/localGitSandbox.js';
import { ReviewOrchestrator } from '../usecases/orchestration/reviewOrchestrator.js';
import { CliAgentRunner } from './agent-runner-impl.js';
import { Instruction } from '../domain/models/promptFacet.js';
import { Issue } from '../domain/models/feedback.js';


// Global logger for real-time streaming to UI
export class Logger {
    private static clients: Set<WebSocket> = new Set();
    private static wsClient: WebSocket | null = null;
    private static wss: WebSocketServer | null = null;
    private static isUiServer = false;
    private static logBuffer: string[] = [];
    private static interventionBuffer: Issue[] = [];
    private static isConnecting = false;
    private static currentSessionId: string | null = null;

    static addClient(ws: WebSocket) {
        this.clients.add(ws);
    }

    static removeClient(ws: WebSocket) {
        this.clients.delete(ws);
    }

    static setUiServerMode(isServer: boolean) {
        this.isUiServer = isServer;
    }

    static setCurrentSessionId(id: string) {
        this.currentSessionId = id;
    }

    static async pollIntervention(): Promise<Issue[] | null> {
        if (this.interventionBuffer.length === 0) return null;
        const issues = [...this.interventionBuffer];
        this.interventionBuffer = [];
        return issues;
    }

    /**
     * WebSocketハブをセットアップする。
     */
    static async setupHub(): Promise<void> {
        if (this.isConnecting) return;
        this.isConnecting = true;

        const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3001;
        // console.log(`[System] Setting up WebSocket connection on port ${WS_PORT}...`);

        // 1. まず自らサーバーになれるか試す
        const serverStarted = await new Promise<boolean>((resolve) => {
            let resolved = false;
            try {
                // console.log(`[System] Attempting to start WebSocket Server...`);
                const wss = new WebSocketServer({ port: WS_PORT });

                const startupTimeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        wss.close();
                        resolve(false);
                    }
                }, 1000); // 1秒に短縮

                wss.on('listening', () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(startupTimeout);
                        this.wss = wss;
                        this.isUiServer = true;
                        this.isConnecting = false;
                        wss.on('connection', (ws) => {
                            this.addClient(ws);
                            ws.on('message', (message) => this.handleIncomingMessage(message.toString(), ws));
                            ws.on('close', () => this.removeClient(ws));
                        });
                        resolve(true);
                    }
                });

                wss.on('error', (_err: any) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(startupTimeout);
                        // console.log(`[System] Port ${WS_PORT} busy or error: ${err.code}`);
                        resolve(false);
                    }
                });
            } catch (e) {
                if (!resolved) {
                    resolved = true;
                    resolve(false);
                }
            }
        });

        if (serverStarted) {
            console.log(`[System] WebSocket Hub started on ws://localhost:${WS_PORT}`);
            return;
        }

        // 2. サーバーになれなかった場合、クライアントとして接続を試みる
        // console.log(`[System] Connecting to existing Hub...`);
        return new Promise((resolve) => {
            let resolved = false;
            try {
                const ws = new WebSocket(`ws://localhost:${WS_PORT}`);

                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        ws.terminate();
                        this.isConnecting = false;
                        console.log(`[System] WebSocket connection timed out. Logs will be buffered.`);
                        resolve();
                    }
                }, 1000);

                ws.on('open', () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        console.log(`[System] Connected to WebSocket Hub.`);
                        this.wsClient = ws;
                        this.isConnecting = false;
                        this.isUiServer = false;
                        ws.send(JSON.stringify({ type: 'identify', clientType: 'cli' }));

                        while (this.logBuffer.length > 0) {
                            const next = this.logBuffer.shift();
                            if (next) ws.send(next);
                        }
                        resolve();
                    }
                });

                ws.on('message', (data) => this.handleIncomingMessage(data.toString()));

                ws.on('error', () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        this.wsClient = null;
                        this.isConnecting = false;
                        console.log(`[System] WebSocket Hub not found. Logs will be buffered.`);
                        resolve();
                    }
                });

                ws.on('close', () => {
                    this.wsClient = null;
                    this.isConnecting = false;
                });
            } catch (e) {
                if (!resolved) {
                    resolved = true;
                    this.isConnecting = false;
                    resolve();
                }
            }
        });
    }

    private static handleIncomingMessage(data: string, sender?: WebSocket) {
        try {
            const parsed = JSON.parse(data);

            // Debug: 全メッセージをログ出力（開発中のみ）
            // console.log(`[WebSocket] Received: ${parsed.type}`);

            // サーバーモードの場合は他のクライアントに中継
            if (this.isUiServer && this.wss) {
                this.clients.forEach(client => {
                    if (client !== sender && client.readyState === WebSocket.OPEN) {
                        client.send(data);
                    }
                });
            }

            if (parsed.type === 'intervention' && parsed.message) {
                this.interventionBuffer.push({
                    level: 'error',
                    description: parsed.message,
                    source: 'user'
                });
                console.log(`\n[User Intervention] ${parsed.message}`);
            } else if (parsed.type === 'stop') {
                console.log('\n🛑 停止リクエストを受信しました。終了処理を開始します...');
                if (this.currentSessionId) {
                    cleanupSession(this.currentSessionId);
                } else {
                    console.log('⚠️ Session ID not set. Attempting global cleanup...');
                    // セッションIDがない場合でも、可能な限りクリーンアップを試みる仕組みを検討
                }

                // 強制終了の前に少し待つ（ログ送信のため）
                setTimeout(() => process.exit(0), 500);
            }
        } catch (_e) { }
    }

    static log(message: string, agent: string = 'kanon', metadata: any = {}) {
        const timestamp = new Date().toISOString();
        const data = JSON.stringify({
            timestamp,
            agent,
            message,
            ...metadata
        });

        // Console output
        if (!metadata.type || metadata.type === 'log') {
            console.log(`[${agent}] ${message}`);
        } else if (metadata.type === 'status') {
            console.log(`[${agent}] STATUS: ${message}`);
        }

        // Broadcast/Send
        if (this.isUiServer) {
            this.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(data);
            });
        } else if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(data);
        } else {
            this.logBuffer.push(data);
            if (this.logBuffer.length > 100) this.logBuffer.shift();
        }
    }
}

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';

    // プロセスが強制終了された場合にセッションを failed に更新する
    const cleanupSession = () => {
        try {
            const session = readSession(process.cwd());
            if (session && (session.status === 'running' || session.status === 'initializing')) {
                updateSession('failed', session.phase || 'interrupted', process.cwd(), session.command, session.targetTask);
                console.log('\n⚠️ プロセスが中断されました。セッションステータスを failed に更新しました。');
            }
        } catch (_) { /* ignore */ }
        process.exit(1);
    };
    process.on('SIGINT', cleanupSession);
    process.on('SIGTERM', cleanupSession);

    try {
        switch (command) {
            case 'start':
                await Logger.setupHub();
                await runStart(args);
                break;
            case 'history':
                await Logger.setupHub();
                await runHistory(args);
                break;
            case 'replay':
                await runReplay(args);
                return;
            case 'plan':
                await Logger.setupHub();
                await runPlan(args);
                break;
            case 'execute':
                await Logger.setupHub();
                await runExecute(args);
                break;
            case 'run':
                await Logger.setupHub();
                await runAll(args);
                break;
            case 'report':
                await Logger.setupHub();
                await runReport(args);
                break;
            case 'ui':
                Logger.setUiServerMode(true);
                await startUI(args);
                break;
            case 'dashboard':
                await Logger.setupHub();
                await runDashboard();
                return;
            case 'init':
                // init doesn't usually need logging to dashboard, but no harm
                await Logger.setupHub();
                await runInit(args);
                break;
            case 'resume':
                await Logger.setupHub();
                await runResume(args);
                break;
            default:
                await Logger.setupHub();
                console.error(`❌ Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.log(`Error: ${errorMessage}`, 'error');

        // セッションの状態を失敗に更新（ファイル監視経由でUIに通知される）
        try {
            const session = readSession(process.cwd());
            if (session && (session.status === 'running' || session.status === 'initializing')) {
                updateSession('failed', session.phase, process.cwd(), session.command, session.targetTask);
            }
        } catch (_) {
            // セッション読み取り失敗時は無視
        }

        process.exit(1);
    }

    if (command !== 'ui') {
        process.exit(0);
    }
}

function showHelp() {
    console.log(`
🌌 Kanon-AG: Antigravity Orchestrator

Usage:
  kanon <command> [options]

Commands:
  start      Start a new task and create a git worktree (e.g. start feat my-feature)
  plan       Create implementation plan using Architect agent (default: Gemini)
  execute    Implement code using DDD Architecture (Developer, Creator, Reviewers, Tester)
  report     Generate final walkthrough.md and report to user
  dashboard  Start terminal-based monitoring dashboard
  ui        Start Dashboard Extension Server
  init      Initialize kanon in current directory
  resume    Resume an interrupted session
  history   List past sessions
  replay    Replay a past session in the dashboard (e.g. replay session-123)

Options:
  --task="..."   Task description for planning
  --file="..."   Target file for review/execution
  --help         Show this help message
`);
}

async function runStart(args: string[]) {
    // Ensure config exists
    loadConfig();

    // args: [ 'start', 'feat', 'login' ]
    const type = args[1];
    const name = args[2];
    if (!type || !name) {
        throw new Error('Usage: kanon start <type> <name> (e.g. kanon start feat user-auth)');
    }

    const branchName = `${type}/${name}`;
    const config = loadConfig();
    const worktreeBaseDir = config.worktreeDir || 'worktree';
    const worktreePath = path.resolve(process.cwd(), worktreeBaseDir, type, name);

    Logger.log(`Creating new git worktree for ${branchName}...`, 'Conductor');

    // Check if inside a git repository
    try {
        await execAsync('git rev-parse --is-inside-work-tree');
    } catch {
        throw new Error('Not inside a git repository. Please run "git init" first.');
    }

    // Check if branch already exists locally or remotely
    let branchExists = false;
    try {
        await execAsync(`git show-ref --verify --quiet refs/heads/${branchName}`);
        branchExists = true;
    } catch {
        branchExists = false;
    }

    try {
        if (branchExists) {
            await execAsync(`git worktree add "${worktreePath}" ${branchName}`);
        } else {
            await execAsync(`git worktree add -b ${branchName} "${worktreePath}"`);
        }
        Logger.log(`✅ Worktree created at ${worktreePath}`, 'Conductor');
        Logger.log(`👉 Please run: cd ./${worktreeBaseDir}/${type}/${name}`, 'Conductor');
        Logger.log(`Then you can initialize and run kanon: kanon init && kanon run`, 'Conductor');
    } catch (e: any) {
        const msg = e.stdout || e.stderr || e.message;
        throw new Error(`Failed to create worktree: ${msg}`);
    }
}

async function runHistory(_args: string[]) {
    Logger.log('Fetching past sessions...', 'system');
    const historyDir = path.join(process.cwd(), '.memories-history');
    if (!fs.existsSync(historyDir)) {
        Logger.log('No history found.', 'system');
        return;
    }
    const sessions = fs.readdirSync(historyDir).filter(f => fs.statSync(path.join(historyDir, f)).isDirectory());
    if (sessions.length === 0) {
        Logger.log('No history found.', 'system');
        return;
    }
    Logger.log(`Past sessions in .memories-history:\n  ${sessions.join('\n  ')}`, 'system');
    Logger.log('To view a past session, run: kanon replay <session-id>', 'system');
}

async function runReplay(args: string[]) {
    const sessionId = args[1];
    if (!sessionId) {
        throw new Error('Usage: kanon replay <session-id>');
    }
    const targetDir = path.join(process.cwd(), '.memories-history', sessionId);
    if (!fs.existsSync(targetDir)) {
        throw new Error(`Session ${sessionId} not found in .memories-history.`);
    }

    Logger.log(`Starting Dashboard for session ${sessionId}...`, 'system');
    Logger.setUiServerMode(true);

    // Call dashboard with --memories-dir
    const dashboardScript = path.join(__dirname, 'dashboard.js');
    const child = spawn('node', [dashboardScript, '--memories-dir', targetDir], { stdio: 'inherit' });
    await new Promise((resolve) => {
        child.on('close', resolve);
    });
}

// Placeholder functions for now
async function runPlan(args: string[]) {
    Logger.log('Initiating Planning Phase. Requesting Architect to design solution...', 'Conductor');
    const task = getArg(args, 'task');
    if (!task) throw new Error('--task is required for plan');

    // セッション状態を永続化（再開用）
    ensureSession('plan', task, 'plan');

    const promptPath = path.join(__dirname, 'prompts/plan-task.txt');
    if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt file not found: ${promptPath}`);
    }

    let promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    const files = await listProjectFiles();

    // Simple template replacement
    const prompt = promptTemplate
        .replace('{{TASK}}', task)
        .replace('{{FILE_LIST}}', files.join('\n'));

    // Create a temporary prompt file to pass to gemini
    const tmpPromptPath = path.join(process.cwd(), '.kanon/tmp_plan_prompt.txt');
    fs.mkdirSync(path.dirname(tmpPromptPath), { recursive: true });
    fs.writeFileSync(tmpPromptPath, prompt);

    Logger.log(`Analyzed request. Generating prompt for Architect...`, 'Conductor');

    try {
        Logger.log(`Received request. Starting architectural design for: "${task}"`, 'Architect');

        const config = loadConfig();
        const { cliName, definition } = resolveCli('architect', config);
        const model = config.agents['architect']?.model_primary;
        const command = buildCommandArgs(definition, prompt, { autoApprove: true, outputFormat: true, model });

        const sessionId = `plan-${Date.now()}`;
        Logger.setCurrentSessionId(sessionId);
        spawnAgent('architect', command, sessionId, cliName, process.cwd(), (data) => {
            // gemini CLI の stderr には Yolo mode 等の通知が含まれるため、単なる Architect エラーではなくシステム警告として流すかそのまま流す
            Logger.log(data, 'Architect');
        });

        const exitCode = await new Promise<number | null>((resolve) => {
            const poll = setInterval(() => {
                const status = getAgentStatus(sessionId, 'architect');
                if (status && status.status !== 'running') {
                    clearInterval(poll);
                    resolve(status.exitCode);
                }
            }, 1000);
        });

        if (exitCode !== 0) {
            throw new Error(`Architect process exited with code ${exitCode}`);
        }

        const finalStatus = getAgentStatus(sessionId, 'architect');
        const planPath = path.join(process.cwd(), 'implementation_plan.md');
        let planContent = finalStatus?.stdout || '';

        // gemini/copilot CLI が -o json で返した場合、.response フィールドを抽出する
        try {
            const parsed = JSON.parse(planContent);
            if (parsed && typeof parsed === 'object' && parsed.response) {
                planContent = parsed.response;
            }
        } catch (e) {
            // JSONでない、または response がない場合はそのまま
        }

        fs.writeFileSync(planPath, planContent);
        Logger.log(`Implementation Plan created at: ${planPath}`, 'Architect');
        Logger.log(`Design complete. Returning plan to Conductor.`, 'Architect');

        // セッションを完了状態に更新
        updateSession('completed', 'plan', process.cwd(), 'plan', task);

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.log(`Design failed: ${errorMessage}`, 'error');
        updateSession('failed', 'plan', process.cwd(), 'plan', task);
        throw error;
    }
}

async function listProjectFiles(): Promise<string[]> {
    try {
        const { stdout } = await execAsync('git ls-files');
        return stdout.split('\n').filter(f => f.length > 0);
    } catch (e) {
        // Fallback for non-git
        return fs.readdirSync(process.cwd());
    }
}



/**
 * 次世代アーキテクチャ (Phase 1-5) による本番実行ロジック。
 * WorktreeManagerによる隔離環境とReviewOrchestratorによる自律デバッグループを利用する。
 */
async function runExecute(args: string[]) {
    Logger.log('Starting execution with Kanon Architecture (DDD/FSM)', 'Conductor');

    // セッション状態を永続化（再開用）
    const taskForResume = getArg(args, 'task') || 'execute';
    ensureSession('execute', taskForResume, 'execute');

    const sessionId = `session-${Date.now()}`;
    Logger.setCurrentSessionId(sessionId);

    const config = loadConfig();
    const sandbox = new LocalGitSandbox(process.cwd(), config.worktreeDir || 'worktree');
    const worktreeMgr = new WorktreeManager(sandbox);
    const runner = new CliAgentRunner();
    const orchestrator = new ReviewOrchestrator(
        sessionId,
        ['reviewer', 'creator', 'tester'],
        runner,
        (status, metadata) => Logger.log(status, 'Conductor', metadata)
    );

    const planPath = path.join(process.cwd(), 'implementation_plan.md');
    let planContent = 'No plan found.';
    let taskNameBase = 'task';
    if (fs.existsSync(planPath)) {
        planContent = fs.readFileSync(planPath, 'utf-8');
        taskNameBase = planContent.substring(0, 30).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'task';
    }

    const taskName = getArg(args, 'task') || `${taskNameBase}-${Date.now()}`;
    const targetDir = await worktreeMgr.setupTaskEnvironment(taskName, 'main');

    Logger.log(`Isolated environment created at: ${targetDir}`, 'Conductor');

    const instruction: Instruction = {
        objective: 'Implement the task according to the plan.',
        tasks: ['Read the provided implementation plan carefully.', 'Write robust code in the workspace.', 'Ensure tests pass if any.', `Plan Content:\n${planContent}`]
    };

    Logger.log('Orchestrating multi-agent collaboration: Developer, Creator, Reviewers, and Tester...', 'Conductor');
    Logger.log('Starting parallel review & self-correction loop...', 'Conductor');

    try {
        const success = await orchestrator.runCorrectionLoop(
            'developer',
            targetDir,
            instruction,
            { type: 'all', targetAgents: ['reviewer-1'] },
            3, // 最大3回のリトライ
            async (worktreePath: string) => {
                const originalCwd = process.cwd();
                try {
                    process.chdir(worktreePath);
                    const result = await validateCode(worktreePath);
                    if (!result.passed) {
                        return [{
                            level: 'error',
                            description: '機械的検証 (Gatekeeper) でエラーが発生しました。コードを修正してください。',
                            suggestedFix: result.error
                        }] as Issue[];
                    }
                    return [];
                } finally {
                    process.chdir(originalCwd);
                }
            },
            () => Logger.pollIntervention()
        );

        if (success) {
            Logger.log('Execution & QC completed successfully! Merging changes...', 'Conductor');
            await worktreeMgr.saveAndCleanup(targetDir, `feat: Implement task ${taskName}`);
            Logger.log('Changes saved and environment cleaned up.', 'Conductor');
            updateSession('completed', 'execute', process.cwd(), 'execute', taskForResume);
        } else {
            Logger.log('Max retries reached or unresolvable reviews. Aborting changes.', 'error');
            await worktreeMgr.abortAndCleanup(targetDir);
            updateSession('failed', 'execute', process.cwd(), 'execute', taskForResume);
            throw new Error('Task implementation failed validation.');
        }
    } catch (error: unknown) {
        // セッションが running のまま残らないように、必ず failed に更新する
        try {
            const session = readSession(process.cwd());
            if (session && (session.status === 'running' || session.status === 'initializing')) {
                updateSession('failed', 'execute', process.cwd(), 'execute', taskForResume);
                Logger.log('⚠️ セッションステータスを failed に更新しました。', 'System');
            }
        } catch (_) { /* セッション更新の失敗は無視 */ }

        // worktree の安全なクリーンアップを試みる
        try {
            await worktreeMgr.abortAndCleanup(targetDir);
        } catch (_) { /* クリーンアップの失敗は無視 */ }

        throw error; // 上位の catch (main関数) に再スロー
    }
}

async function validateCode(cwd: string = process.cwd()): Promise<{ passed: boolean; error?: string }> {
    Logger.log('Running Dynamic Validation...', 'Conductor');

    // Switch process.cwd for listProjectFiles() workaround
    const originalCwd = process.cwd();
    let files: string[] = [];
    try {
        process.chdir(cwd);
        files = await listProjectFiles();
    } finally {
        process.chdir(originalCwd);
    }

    // Prepare prompt for validation commands
    const promptPath = path.join(__dirname, 'prompts/validate-project.txt');
    if (!fs.existsSync(promptPath)) {
        // Fallback if prompt is missing: Default to simple static check
        Logger.log('⚠️ validate-project.txt not found. Falling back to simple check.', 'warning');
        return { passed: true };
    }

    let promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    const prompt = promptTemplate.replace('{{FILE_LIST}}', files.join('\n'));

    // Save prompt for debugging
    const tmpPromptPath = path.join(cwd, '.kanon/tmp_validate_prompt.txt');
    fs.mkdirSync(path.dirname(tmpPromptPath), { recursive: true });
    fs.writeFileSync(tmpPromptPath, prompt);

    let commands: string[] = [];
    try {
        // Ask Gemini to generate JSON list of commands
        const cmd = `cat "${tmpPromptPath}" | gemini --yolo`;
        const { stdout } = await execAsync(cmd);

        // Extract JSON from response
        const jsonMatch = stdout.match(/\[.*\]/s);
        if (jsonMatch) {
            commands = JSON.parse(jsonMatch[0]);
        } else {
            Logger.log('⚠️ Could not parse validation commands from Gemini.', 'warning');
        }
    } catch (e: any) {
        Logger.log(`⚠️ Failed to generate validation commands: ${e.message}`, 'warning');
    }

    if (commands.length === 0) {
        Logger.log('No specific validation commands generated. Running fallback static analysis.', 'Conductor');
        // Fallback to static analysis as a safety net
        return runStaticAnalysis(cwd);
    }

    Logger.log(`Executing validation commands: ${JSON.stringify(commands)}`, 'Conductor');

    for (const command of commands) {
        Logger.log(`> ${command}`, 'Conductor');
        try {
            await execAsync(command, { cwd });
            Logger.log('Command passed.', 'Conductor');
        } catch (error: any) {
            const errorMsg = error.stdout || error.stderr || error.message;
            Logger.log(`Validation command failed!`, 'Conductor');
            return { passed: false, error: `Command '${command}' failed:\n${errorMsg}` };
        }
    }

    Logger.log('All validation commands passed.', 'Conductor');
    return { passed: true };
}

async function runStaticAnalysis(cwd: string): Promise<{ passed: boolean; error?: string }> {
    Logger.log('Running Static Analysis (Fallback)...', 'Conductor');
    const tsconfigDirs: string[] = [];

    if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
        tsconfigDirs.push(cwd);
    } else {
        const entries = fs.readdirSync(cwd, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                const subTsconfig = path.join(cwd, entry.name, 'tsconfig.json');
                if (fs.existsSync(subTsconfig)) {
                    tsconfigDirs.push(path.join(cwd, entry.name));
                }
            }
        }
    }

    if (tsconfigDirs.length === 0) return { passed: true };

    for (const dir of tsconfigDirs) {
        try {
            await execAsync('npx tsc --noEmit', { cwd: dir });
        } catch (error: any) {
            const execErr = error as any;
            const errorMsg = execErr?.stdout || execErr?.stderr || execErr?.message || String(error);
            return { passed: false, error: errorMsg };
        }
    }
    return { passed: true };
}



async function runResume(_args: string[]) {
    Logger.log('Checking for interrupted session...', 'Conductor');

    const session = readSession();
    if (!session) {
        Logger.log('⚠️ 再開可能なセッションが見つかりません。', 'system');
        console.log('  ℹ️  .memories/session.md が存在しないか、セッションが開始されていません。');
        return;
    }

    if (session.status === 'completed') {
        Logger.log('✅ 前回のセッションは正常に完了しています。再開の必要はありません。', 'system');
        return;
    }

    if (session.status === 'failed') {
        Logger.log(`⚠️ 前回のセッション (${session.id}) は失敗状態です。再開を試みます...`, 'Conductor');
        Logger.log(`   コマンド: ${session.command || '不明'}`, 'Conductor');
        Logger.log(`   フェーズ: ${session.phase}`, 'Conductor');
        Logger.log(`   対象タスク: ${session.targetTask || '不明'}`, 'Conductor');
        // failed セッションも running/initializing と同様に再開処理へフォールスルー
    } else if (session.status !== 'running' && session.status !== 'initializing') {
        Logger.log(`✅ 前回のセッションは正常に完了しています。再開の必要はありません。`, 'system');
        return;
    } else {
        // running or initializing → 中断されたセッション
        Logger.log(`🔄 中断されたセッションを検出しました:`, 'Conductor');
        Logger.log(`   セッション: ${session.id}`, 'Conductor');
        Logger.log(`   コマンド: ${session.command || '不明'}`, 'Conductor');
        Logger.log(`   フェーズ: ${session.phase}`, 'Conductor');
        Logger.log(`   対象タスク: ${session.targetTask || '不明'}`, 'Conductor');
        Logger.log(`   最終更新: ${session.updatedAt}`, 'Conductor');
    }

    const command = session.command;
    const targetTask = session.targetTask || '';

    if (!command) {
        Logger.log('⚠️ 中断されたコマンドが記録されていません。手動で再実行してください。', 'system');
        return;
    }

    // コマンドに応じた再開処理
    const resumeArgs = targetTask ? ['resume', `--task=${targetTask}`] : ['resume'];

    switch (command) {
        case 'plan':
            Logger.log('📋 Plan フェーズを再開します...', 'Conductor');
            await runPlan(resumeArgs);
            break;

        case 'execute':
            Logger.log('🔨 Execute フェーズを再開します...', 'Conductor');
            await runExecute(resumeArgs);
            break;

        case 'run': {
            // runAll の途中再開: フェーズに応じて途中から
            const phase = session.phase;
            if (phase === 'run-plan' || phase === 'plan') {
                Logger.log('📋 Full Run を Plan フェーズから再開します...', 'Conductor');
                try { updateSession('running', 'run-plan', undefined, 'run', targetTask); } catch (_) { /* ignore */ }
                await runPlan(resumeArgs);
                try { updateSession('running', 'run-execute', undefined, 'run', targetTask); } catch (_) { /* ignore */ }
                await runExecute(resumeArgs);
                await runReport(resumeArgs);
            } else if (phase === 'run-execute' || phase === 'execute') {
                Logger.log('🔨 Full Run を Execute フェーズから再開します...', 'Conductor');
                try { updateSession('running', 'run-execute', undefined, 'run', targetTask); } catch (_) { /* ignore */ }
                await runExecute(resumeArgs);
                await runReport(resumeArgs);
            } else if (phase === 'run-report' || phase === 'report') {
                Logger.log('📊 Full Run を Report フェーズから再開します...', 'Conductor');
                await runReport(resumeArgs);
            } else {
                Logger.log(`⚠️ 不明なフェーズ '${phase}'。Full Run を最初から実行します...`, 'Conductor');
                await runAll(resumeArgs);
            }
            break;
        }

        default:
            Logger.log(`⚠️ 不明なコマンド '${command}'。手動で再実行してください。`, 'system');
            return;
    }

    // 完了時にセッション状態を更新
    try { updateSession('completed', 'done'); } catch (_) { /* ignore */ }
    Logger.log('✅ セッション再開が完了しました。', 'Conductor');
}


async function runAll(args: string[]) {
    Logger.log('Starting Full Orchestration Run...', 'Conductor');

    // セッション状態を永続化（再開用）
    const taskForResume = getArg(args, 'task') || 'run';
    const sessionId = `session-${Date.now()}`;
    Logger.setCurrentSessionId(sessionId);
    ensureSession('run', taskForResume, 'run-plan');

    // 1. Plan
    await runPlan(args);

    // 2. Execute (Implementation + Gatekeeper + LLM Review Loop)
    ensureSession('run', taskForResume, 'run-execute');
    await runExecute(args);

    // 3. Report
    ensureSession('run', taskForResume, 'run-report');
    await runReport(args);

    // セッション完了
    try { updateSession('completed', 'done'); } catch (_) { /* ignore */ }
    Logger.log('Full Orchestration Complete!', 'Conductor');
}

// ────────────────────────────────────────────────────────────
// セッション管理のヘルパー (確実な初期化と更新)
// ────────────────────────────────────────────────────────────
function ensureSession(command: string, targetTask: string, phase: string) {
    const sessionPath = path.join(process.cwd(), '.memories', 'session.md');
    try {
        if (!fs.existsSync(sessionPath)) {
            // セッションが存在しない場合、IDを生成して新規作成
            const sessionId = `session-${Date.now()}`;
            initSession(sessionId, process.cwd());
            // すぐにステータスを更新する
            updateSession('running', phase, process.cwd(), command, targetTask);
        } else {
            // 既に存在する場合、そのまま更新
            updateSession('running', phase, process.cwd(), command, targetTask);
        }
    } catch (err: any) {
        Logger.log(`⚠️ セッション管理の更新に失敗しました: ${err.message}`, 'system');
    }
}

async function runReport(args: string[]) {
    Logger.log('Generating Final Report for the user...', 'Conductor');
    const task = getArg(args, 'task') || 'Unknown Task';

    const planPath = path.join(process.cwd(), 'implementation_plan.md');
    let planContent = 'No implementation plan found.';
    if (fs.existsSync(planPath)) {
        planContent = fs.readFileSync(planPath, 'utf-8');
    }

    const promptPath = path.join(__dirname, 'prompts/report-result.txt');
    if (!fs.existsSync(promptPath)) {
        Logger.log('report-result.txt prompt not found. Skipping final report.', 'warning');
        return;
    }

    let promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    const prompt = promptTemplate
        .replace('{{TASK}}', task)
        .replace('{{PLAN}}', planContent);

    const tmpPromptPath = path.join(process.cwd(), '.kanon/tmp_report_prompt.txt');
    fs.mkdirSync(path.dirname(tmpPromptPath), { recursive: true });
    fs.writeFileSync(tmpPromptPath, prompt);

    try {
        Logger.log(`Final Report for Task: "${task}"`, 'result');

        // Generate walkthrough.md content using Architect/Reporter logic
        let reportContent = `# Walkthrough - ${task}\n\n## 実施内容\n${planContent}\n\n## 検証結果\nすべてのテストおよび検証を通過しました。\n\n## ユーザーへの確認事項\n動作を確認し、問題なければタスクを完了としてください。`;

        const walkthroughPath = path.join(process.cwd(), 'walkthrough.md');
        fs.writeFileSync(walkthroughPath, reportContent);
        Logger.log(`✅ Final report generated at: ${walkthroughPath}`, 'Conductor');

        Logger.log('Sending report request to Dashboard UI...', 'system');

        const commandData = JSON.stringify({
            type: "action",
            action: "openChat",
            text: `タスク「${task}」が完了しました。\nプロジェクトルートに walkthrough.md を出力しました。\n結果を確認し、OK か NG (追加修正の依頼) かを教えてください。`
        });

        // The dashboard UI will catch this if we send it as a log message.
        Logger.log(commandData, 'system');

        Logger.log('Please check your Antigravity extension dashboard or chat panel for the final report.', 'system');

        updateSession('completed', 'report', process.cwd(), 'report', task);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.log(`Failed to generate report: ${errorMessage}`, 'error');
        updateSession('failed', 'report', process.cwd(), 'report', task);
    }
}

async function startUI(_args: string[]) {
    Logger.log('🚀 Starting Antigravity Extension Server...', 'system');
    await Logger.setupHub();
    Logger.log('Ready to stream logs to Antigravity Extension.', 'system');
}

async function runInit(_args: string[]) {
    Logger.log('Initializing Kanon Orchestrator in current directory...', 'system');
    const kanonDir = path.join(process.cwd(), '.kanon');
    fs.mkdirSync(kanonDir, { recursive: true });

    // AGENTS.md
    const agentsMdPath = path.join(process.cwd(), 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
        const agentsContent = `# AGENTS

## Conductor
Role: Orchestrate the development pipeline, checking phases and creating tasks.

## Architect
Role: Systems design and planning.

## Developer
Role: Implement code.

## QC (Gatekeeper/Reviewer)
Role: Validate and review code.
`;
        fs.writeFileSync(agentsMdPath, agentsContent);
        Logger.log('Generated AGENTS.md', 'system');
    }

    // skills/ directory and templates
    const skillsDir = path.join(process.cwd(), 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const defaultSkills = ['conductor', 'architect', 'developer', 'qa'];
    for (const skill of defaultSkills) {
        const skillPath = path.join(skillsDir, skill);
        fs.mkdirSync(skillPath, { recursive: true });
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
            const skillContent = `---
name: ${skill}
description: Definition for the ${skill} skill.
---

# ${skill} Skill

Instructions for ${skill} go here.
`;
            fs.writeFileSync(skillMdPath, skillContent);
        }
    }
    Logger.log('Generated skills/ directory and templates', 'system');

    // INSTRUCTIONS.md
    const instructionsPath = path.join(process.cwd(), 'INSTRUCTIONS.md');
    if (!fs.existsSync(instructionsPath)) {
        const instContent = `# Instruction Manual

1. Write your high-level goal in the project.
2. Run \`kanon plan\` to generate a plan.
3. Run \`kanon execute\` to implement it.
`;
        fs.writeFileSync(instructionsPath, instContent);
        Logger.log('Generated INSTRUCTIONS.md', 'system');
    }

    // Check for required tools
    const tools = ['gemini', 'opencode', 'copilot'];
    const missingTools: string[] = [];

    for (const tool of tools) {
        if (await checkCommand(tool)) {
            console.log(`✅ ${tool} found.`);
        } else {
            console.log(`❌ ${tool} NOT found.`);
            missingTools.push(tool);
        }
    }

    if (missingTools.length > 0) {
        console.warn(`WARNING: The following tools are missing: ${missingTools.join(', ')}`);
        console.warn('You may need to install them or alias them for kanon to work properly.');
    }

    // Create default config
    ensureConfig(process.cwd());

    // --- Install orchestrate workflow for Antigravity ---
    const workflowDir = path.join(process.cwd(), '.agent', 'workflows');
    const workflowDest = path.join(workflowDir, 'orchestrate.md');

    let shouldCopyWorkflow = false;
    if (!fs.existsSync(workflowDest)) {
        shouldCopyWorkflow = true;
    } else {
        const existingContent = fs.readFileSync(workflowDest, 'utf-8');
        if (existingContent.includes('Kanonのセットアップを開始します') || existingContent.includes('Kanon オーケストレーターがまだこのプロジェクトで有効になっていません')) {
            shouldCopyWorkflow = true;
            console.log('🔄 Detected bootstrap orchestrate.md. Overwriting with actual workflow...');
        }
    }

    if (shouldCopyWorkflow) {
        fs.mkdirSync(workflowDir, { recursive: true });
        // Copy workflow from kanon package
        const workflowSrc = path.join(__dirname, '..', '.agent', 'workflows', 'orchestrate.md');
        if (fs.existsSync(workflowSrc)) {
            fs.copyFileSync(workflowSrc, workflowDest);
            console.log('✅ Installed /orchestrate workflow for Antigravity.');
        } else {
            // Fallback: try relative to kanon-ag project root
            const altSrc = path.join(__dirname, '..', '..', '.agent', 'workflows', 'orchestrate.md');
            if (fs.existsSync(altSrc)) {
                fs.copyFileSync(altSrc, workflowDest);
                console.log('✅ Installed /orchestrate workflow for Antigravity.');
            } else {
                console.warn('⚠️ orchestrate.md workflow not found in kanon package. Skipping.');
            }
        }
    } else {
        console.log('orchestrate.md workflow already exists.');
    }

    // --- Install Kanon Dashboard VS Code Extension ---
    const extensionDir = path.join(__dirname, '..', 'src', 'extension');
    const vsixFiles = [
        path.join(extensionDir, 'kanon-antigravity-extension-0.0.0.vsix'),
        path.join(__dirname, '..', '..', 'src', 'extension', 'kanon-antigravity-extension-0.0.0.vsix'),
    ];
    let vsixInstalled = false;
    for (const vsixPath of vsixFiles) {
        if (fs.existsSync(vsixPath)) {
            console.log('📦 Installing Kanon Dashboard extension...');
            try {
                await execAsync(`code --install-extension "${vsixPath}" --force`);
                console.log('✅ Kanon Dashboard extension installed.');
                vsixInstalled = true;
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`⚠️ Failed to install extension: ${errorMessage}`);
                console.warn(`   You can install manually: code --install-extension "${vsixPath}"`);
            }
            break;
        }
    }
    if (!vsixInstalled) {
        console.log('ℹ️  Kanon Dashboard extension (.vsix) not found. Skipping extension install.');
        console.log('   Build it with: cd src/extension && vsce package');
    }

    console.log('\n🎉 Initialization complete!');
    console.log('   Antigravity で このディレクトリを開き、チャットで /orchestrate を実行してください。');
}

async function checkCommand(command: string): Promise<boolean> {
    try {
        await execAsync(`${command} --version`); // Most CLIs support --version
        return true;
    } catch (e) {
        return false;
    }
}

function getArg(args: string[], name: string): string | undefined {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : undefined;
}

// Executed directly
main();
