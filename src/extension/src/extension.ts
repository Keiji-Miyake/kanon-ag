import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';

let taskTerminal: vscode.Terminal | undefined;
let wss: WebSocketServer | undefined;
let wsHttpServer: ReturnType<typeof createServer> | undefined;
let fileWatcher: ReturnType<typeof chokidar.watch> | undefined;
const WS_PORT = 3001;

// postMessage 送信先 Webview の参照（状態隔離のため WSブロードキャストは使わない）
let dashboardProvider: KanonDashboardProvider | undefined;

// =============================================================================
// 状態管理：エージェントの実行状態を表すデータ型
// =============================================================================

interface AgentStatus {
    name: string;
    status: 'idle' | 'running' | 'done' | 'error';
    lastMessage?: string;
    startedAt?: string;
    finishedAt?: string;
}

interface ActivityEntry {
    timestamp: string;
    agent: string;
    message: string;
    type?: 'log' | 'status' | 'error';
}

interface KanonState {
    sessionId?: string;
    task?: string;
    overallStatus: 'idle' | 'running' | 'done' | 'error';
    startedAt?: string;
    finishedAt?: string;
    agents: AgentStatus[];
    activities: ActivityEntry[];
    lastUpdated: string;
    isInitialized: boolean;
    isCliConnected: boolean;
}

let currentState: KanonState = {
    overallStatus: 'idle',
    agents: [
        { name: 'Conductor', status: 'idle' },
        { name: 'Architect', status: 'idle' },
        { name: 'Developer', status: 'idle' },
        { name: 'QC', status: 'idle' },
    ],
    activities: [],
    lastUpdated: new Date().toISOString(),
    isInitialized: false,
    isCliConnected: false,
};

// CLIエージェントのWebSocket接続を保持（介入送信用）
let cliWebSocket: WebSocket | undefined;

// =============================================================================
// .memories/ ファイルパース処理
// =============================================================================

/**
 * .memories/ ディレクトリ配下のファイルを読み取り KanonState を構築する。
 * session.md, task-board.md, progress/*.md を対象とする。
 */
function parseMemoriesToState(memoriesDir: string): Partial<KanonState> {
    const updates: Partial<KanonState> = {};

    try {
        // session.md の読み込み
        const sessionPath = path.join(memoriesDir, 'session.md');
        if (fs.existsSync(sessionPath)) {
            const content = fs.readFileSync(sessionPath, 'utf-8');
            // セッションIDを "# Session: xxx" or "sessionId: xxx" 形式でパース
            const sessionIdMatch = content.match(/(?:# Session:|sessionId:)\s*(.+)/i);
            if (sessionIdMatch) {
                updates.sessionId = sessionIdMatch[1].trim();
            }
            // タスク名をパース
            const taskMatch = content.match(/\|\s*\*\*対象タスク\*\*\s*\|\s*(.*?)\s*\|/i) || content.match(/(?:task:|## Task:|タスク:)\s*(.+)/i);
            if (taskMatch) {
                updates.task = taskMatch[1].trim();
                // '-' の場合はタスクなしとして扱う
                if (updates.task === '-') updates.task = '';
            }
            // 開始時刻をパース
            const startedMatch = content.match(/\|\s*\*\*開始\*\*\s*\|\s*(.*?)\s*\|/i) || content.match(/(?:startedAt:|started:|開始:|## Started:)\s*(.+)/i);
            if (startedMatch) {
                updates.startedAt = startedMatch[1].trim();
            }
            // 状態をパース
            const statusMatch = content.match(/\|\s*\*\*ステータス\*\*\s*\|\s*(.*?)\s*\|/i) || content.match(/(?:status:|## Status:|状態:)\s*(.+)/i);
            if (statusMatch) {
                const rawStatus = statusMatch[1].trim().toLowerCase();
                if (rawStatus.includes('run') || rawStatus.includes('実行') || rawStatus.includes('initializing') || rawStatus.includes('▶')) {
                    updates.overallStatus = 'running';
                } else if (rawStatus.includes('done') || rawStatus.includes('完了') || rawStatus.includes('completed') || rawStatus.includes('✅')) {
                    updates.overallStatus = 'done';
                } else if (rawStatus.includes('error') || rawStatus.includes('エラー') || rawStatus.includes('failed') || rawStatus.includes('❌')) {
                    updates.overallStatus = 'error';
                } else {
                    // 何も当てはまらない場合、行の内容を見て判断を試みる
                    const lineContent = statusMatch[0].toLowerCase();
                    if (lineContent.includes('running') || lineContent.includes('実行')) {
                        updates.overallStatus = 'running';
                    } else {
                        updates.overallStatus = 'idle';
                    }
                }
            }
        }

        // task-board.md の読み込み
        const taskBoardPath = path.join(memoriesDir, 'task-board.md');
        if (fs.existsSync(taskBoardPath)) {
            const content = fs.readFileSync(taskBoardPath, 'utf-8');
            if (!updates.task) {
                const taskMatch = content.match(/(?:# Task:|## Current Task:|タスク:)\s*(.+)/i);
                if (taskMatch) {
                    updates.task = taskMatch[1].trim();
                }
            }
        }

        // progress/*.md の読み込み（エージェントステータスの更新）
        const progressDir = path.join(memoriesDir, 'progress');
        if (fs.existsSync(progressDir)) {
            const agents: AgentStatus[] = [...currentState.agents];

            const files = fs.readdirSync(progressDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const filePath = path.join(progressDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');

                // ファイル名からエージェント名を推定
                const agentNameMatch = file.match(/^(\w+)/);
                const agentName = agentNameMatch ? agentNameMatch[1] : file.replace('.md', '');

                // ステータスをパース
                const statusMatch = content.match(/(?:status:|## Status:|状態:)\s*(.+)/i);
                let agentStatus: AgentStatus['status'] = 'idle';
                if (statusMatch) {
                    const raw = statusMatch[1].trim().toLowerCase();
                    if (raw.includes('run') || raw.includes('実行')) agentStatus = 'running';
                    else if (raw.includes('done') || raw.includes('完了')) agentStatus = 'done';
                    else if (raw.includes('error') || raw.includes('エラー')) agentStatus = 'error';
                }

                // 最終メッセージをパース
                const lines = content.split('\n').filter(l => l.trim());
                const lastMessage = lines[lines.length - 1];

                // 既存エージェントを更新、なければ追加
                const existingIdx = agents.findIndex(a =>
                    a.name.toLowerCase() === agentName.toLowerCase());
                if (existingIdx >= 0) {
                    agents[existingIdx] = { ...agents[existingIdx], status: agentStatus, lastMessage };
                } else {
                    agents.push({ name: agentName, status: agentStatus, lastMessage });
                }
            }
            updates.agents = agents;
        }

    } catch (err) {
        console.error('[Kanon] .memories/ パースエラー:', err);
    }

    // セットアップ状態の確認: AGENTS.md の存在をもって初期化済みとみなす
    const agentsMdPath = path.join(path.dirname(memoriesDir), 'AGENTS.md');
    updates.isInitialized = fs.existsSync(agentsMdPath);

    return updates;
}

/**
 * 現在の状態を Webview の postMessage で送信する。
 * WS ブロードキャストは使わず、開いているダッシュボード Webview にのみ送信する。
 * これにより複数 VSCode ウィンドウ間の状態の混線を防ぐ。
 */
function pushStateToWebview() {
    if (dashboardProvider) {
        dashboardProvider.postState(currentState);
    }
}

/**
 * ワークスペースの .memories/ ディレクトリを chokidar で監視し、
 * 変更があるたびに状態を更新してブロードキャストする。
 */
function startFileWatcher(workspaceRoot: string) {
    const memoriesDir = path.join(workspaceRoot, '.memories');

    // 監視ディレクトリが存在しない場合は作成しておく
    if (!fs.existsSync(memoriesDir)) {
        fs.mkdirSync(memoriesDir, { recursive: true });
    }

    const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');

    // 初期状態をロード
    const initialUpdates = parseMemoriesToState(memoriesDir);
    initialUpdates.isInitialized = fs.existsSync(agentsMdPath);
    currentState = { ...currentState, ...initialUpdates, lastUpdated: new Date().toISOString() };

    if (fileWatcher) {
        fileWatcher.close();
    }

    fileWatcher = chokidar.watch([memoriesDir, agentsMdPath], {
        ignoreInitial: false,
        persistent: true,
        depth: 3,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
        },
    });

    const onFileChange = (_filePath: string) => {
        const updates = parseMemoriesToState(memoriesDir);
        // overallStatus が 'idle' とパースされた場合でも、以前の状態が 'running' なら簡単に戻さない
        // (ファイル書き込み中の不完全なファイル読み込みによる誤判定を防止)
        if (updates.overallStatus === 'idle' && currentState.overallStatus === 'running') {
            // session.md を直接チェックして再確認
            const sessionPath = path.join(memoriesDir, 'session.md');
            if (fs.existsSync(sessionPath)) {
                const content = fs.readFileSync(sessionPath, 'utf-8');
                if (content.includes('running') || content.includes('▶')) {
                    updates.overallStatus = 'running';
                } else if (!content.includes('completed') && !content.includes('done')) {
                    // 完了もしていないなら、意図しないリセットの可能性が高いので running を維持
                    delete updates.overallStatus;
                }
            } else {
                // ファイル自体が消えたのでない限り、running を維持
                delete updates.overallStatus;
            }
        }
        currentState = { ...currentState, ...updates, lastUpdated: new Date().toISOString() };
        pushStateToWebview();
    };

    fileWatcher
        .on('add', onFileChange)
        .on('change', onFileChange)
        .on('unlink', onFileChange)
        .on('error', (err) => console.error('[Kanon] chokidar エラー:', err));

    console.log(`[Kanon] ファイル監視開始: ${memoriesDir}, ${agentsMdPath}`);
}

function stopFileWatcher() {
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = undefined;
    }
}

// =============================================================================
// 拡張機能内蔵 WebSocket サーバー
// =============================================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('Kanon Extension Activated (State Sync + File Watch - Rebuilt)!');

    // 拡張機能起動時に WebSocket サーバーとファイル監視を自動起動
    startEmbeddedServer();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        startFileWatcher(workspaceRoot);
        ensureBootstrapWorkflow(workspaceRoot);
    }

    // ワークスペースフォルダが変わったときも再起動
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            stopFileWatcher();
            const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (newRoot) {
                startFileWatcher(newRoot);
                ensureBootstrapWorkflow(newRoot);
            }
        })
    );

    const provider = new KanonDashboardProvider(context.extensionUri);
    dashboardProvider = provider; // モジュールレベルで参照できるようにする（状態隔離のため）

    const vsWindow = vscode.window as any;
    if (vsWindow.registerWebviewViewProvider) {
        context.subscriptions.push(
            vsWindow.registerWebviewViewProvider(KanonDashboardProvider.viewType, provider));
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('kanon.hello', () => {
            vscode.window.showInformationMessage('Hello from Kanon Extension (v0.2.0)!');
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand('kanon.openDashboard', () => {
            vscode.commands.executeCommand('kanon.dashboard.focus');
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand('kanon.orchestrate', async () => {
            const task = await vscode.window.showInputBox({
                prompt: '実行したいタスクを入力してください（例: ログイン画面の作成）',
                placeHolder: 'タスクの内容...'
            });

            if (!task) return;

            // ダッシュボードを表示
            vscode.commands.executeCommand('kanon.dashboard.focus');

            // ターミナルでオーケストレーションを開始
            // ここでは /orchestrate ワークフローを起動することを想定
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!taskTerminal || taskTerminal.exitStatus) {
                taskTerminal = vscode.window.createTerminal({
                    name: 'Kanon Orchestration',
                    cwd: workspaceFolder
                });
            }
            taskTerminal.show();

            const getCmd = () => {
                const localDevPath = path.join(workspaceFolder || '', 'dist', 'cli', 'orchestrate.js');
                if (fs.existsSync(localDevPath)) {
                    return `node --no-deprecation ./dist/cli/orchestrate.js run --task='${task}'`;
                }
                return `kanon run --task='${task}'`;
            };

            taskTerminal.sendText('export NODE_NO_WARNINGS=1');
            taskTerminal.sendText(getCmd());
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand('kanon.initProject', () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!taskTerminal) {
                taskTerminal = (vscode.window as any).createTerminal({
                    name: 'Kanon Init',
                    cwd: workspaceFolder
                });
            }
            const terminal = taskTerminal!;
            terminal.show();

            // Similar logic to runWorkflow to find kanon
            const getInitCmd = () => {
                const localDevPath = path.join(workspaceFolder || '', 'dist', 'cli', 'orchestrate.js');
                const localNpmPath = path.join(workspaceFolder || '', 'node_modules', '.bin', 'kanon');

                if (fs.existsSync(localDevPath)) {
                    return `node --no-deprecation ./dist/cli/orchestrate.js init`;
                } else if (fs.existsSync(localNpmPath)) {
                    return `npx kanon init`;
                } else {
                    return `kanon init`;
                }
            };

            terminal.sendText('export NODE_NO_WARNINGS=1');
            terminal.sendText(getInitCmd());
        }));
}

/**
 * プロジェクトが未初期化の場合、チャットから setup できるように最小限の /orchestrate ワークフローを配置する
 */
function ensureBootstrapWorkflow(workspaceRoot: string) {
    const workflowDir = path.join(workspaceRoot, '.agent', 'workflows');
    const workflowPath = path.join(workflowDir, 'orchestrate.md');
    const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');

    // 既に AGENTS.md があるか、orchestrate.md がある場合は何もしない
    if (fs.existsSync(agentsMdPath) || fs.existsSync(workflowPath)) {
        return;
    }

    try {
        if (!fs.existsSync(workflowDir)) {
            fs.mkdirSync(workflowDir, { recursive: true });
        }

        const bootstrapContent = `---
description: Kanonのセットアップを開始します
---

# /orchestrate - Kanon セットアップ

Kanon オーケストレーターがまだこのプロジェクトで有効になっていません。
セットアップを実行して、自律開発エンジン（Conductor, Architect, Developer等）を有効にしますか？

// turbo
- \`kanon init\` を実行して初期化する

> セットアップが完了すると、本来の自律開発パイプラインが利用可能になります。
`;

        fs.writeFileSync(workflowPath, bootstrapContent);
        console.log('[Kanon] Bootstrap workflow created.');
    } catch (err) {
        console.error('[Kanon] Failed to create bootstrap workflow:', err);
    }
}

export function deactivate() {
    if (taskTerminal) {
        taskTerminal.dispose();
    }
    stopEmbeddedServer();
    stopFileWatcher();
}

/**
 * 拡張機能内で WebSocket サーバーを起動する。
 * CLIツール (kanon run, kanon execute 等) からのログを中継してダッシュボードUIへ流す。
 * また、ファイル監視による状態更新もこのサーバー経由でブロードキャストされる。
 */
function startEmbeddedServer() {
    if (wss) return; // 既に起動済み

    wsHttpServer = createServer();
    wss = new WebSocketServer({ noServer: true });

    wsHttpServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Kanon] WebSocket ポート ${WS_PORT} は既に使用中です。`);
        } else {
            console.error('[Kanon] WebSocket サーバーエラー:', err);
        }
    });

    wsHttpServer.on('upgrade', (request, socket, head) => {
        wss!.handleUpgrade(request, socket, head, (ws) => {
            wss!.emit('connection', ws, request);
        });
    });

    wsHttpServer.listen(WS_PORT, () => {
        console.log(`[Kanon] WebSocket サーバー起動: ws://localhost:${WS_PORT}`);
    });

    wss.on('connection', (ws: WebSocket) => {
        let isActuallyCli = false;
        console.log('[Kanon] 新規クライアント接続');

        ws.on('close', () => {
            console.log('[Kanon] クライアント切断');
            if (isActuallyCli) {
                currentState.isCliConnected = false;
                cliWebSocket = undefined;
                pushStateToWebview();
            }
        });

        ws.on('message', (message) => {
            const data = message.toString();
            try {
                const parsed = JSON.parse(data);

                // Identify CLI
                if (parsed.type === 'identify' && parsed.clientType === 'cli') {
                    console.log('[Kanon] CLIエージェントを識別しました');
                    isActuallyCli = true;
                    currentState.isCliConnected = true;
                    cliWebSocket = ws;
                    pushStateToWebview();
                    return;
                }

                // CLIからの定期的なパルスまたは実行中通知を受け取った場合、状態を running に固定する
                if (parsed.type === 'status') {
                    currentState.overallStatus = 'running';
                }

                if (parsed.agent && parsed.message) {
                    const activity: ActivityEntry = {
                        timestamp: parsed.timestamp || new Date().toISOString(),
                        agent: parsed.agent,
                        message: parsed.message,
                        type: parsed.type || 'log',
                    };
                    currentState.activities = [...currentState.activities.slice(-99), activity];
                    currentState.lastUpdated = new Date().toISOString();

                    // エージェントステータス更新（statusタイプのメッセージの場合）
                    if (parsed.type === 'status') {
                        const agentIdx = currentState.agents.findIndex(
                            a => a.name.toLowerCase() === parsed.agent.toLowerCase()
                        );
                        if (agentIdx >= 0) {
                            currentState.agents[agentIdx].lastMessage = parsed.message;
                            if (parsed.message.includes('完了') || parsed.message.includes('done')) {
                                currentState.agents[agentIdx].status = 'done';
                            } else if (parsed.message.includes('開始') || parsed.message.includes('start')) {
                                currentState.agents[agentIdx].status = 'running';
                            }
                        }
                    }
                    // 状態更新をWebviewにのみ送信（WSブロードキャストは行わない）
                    pushStateToWebview();
                }
            } catch (_e) {
                // JSON でない場合は無視
            }
        });
    });
}

function stopEmbeddedServer() {
    if (wss) {
        wss.close();
        wss = undefined;
    }
    if (wsHttpServer) {
        wsHttpServer.close();
        wsHttpServer = undefined;
    }
}

// =============================================================================
// ダッシュボード Webview プロバイダー
// =============================================================================

class KanonDashboardProvider {

    public static readonly viewType = 'kanon.dashboard';
    private _view?: any;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    /**
     * 現在の状態を Webview に postMessage で送信する。
     * WS ブロードキャストではなく、このメソッドで必ず送信する（状態の隔離）。
     */
    public postState(state: KanonState) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'state', state });
        }
    }

    public resolveWebviewView(
        webviewView: any,
        _context: any,
        _token: any,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((data: any) => {
            switch (data.command) {
                case 'runWorkflow':
                    this.runWorkflow(data.workflow, data.task);
                    break;
                case 'initProject':
                    vscode.commands.executeCommand('kanon.initProject');
                    break;
                case 'resumeSession':
                    this.runResumeSession();
                    break;
                case 'sendIntervention':
                    this.sendInterventionToCli(data.message);
                    break;
                case 'stopOrchestration':
                    this.sendStopToCli();
                    break;
                case 'ready':
                    // Webviewの初期化完了後に現在の状態を postMessage で送信する
                    webviewView.webview.postMessage({ type: 'state', state: currentState });
                    break;
            }
        });
    }

    public runWorkflow(workflow: string, task: string) {
        if (!taskTerminal || taskTerminal.exitStatus) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            taskTerminal = vscode.window.createTerminal({
                name: 'Kanon Task Execution',
                cwd: workspaceFolder
            });
        }
        taskTerminal.show();

        let cmd = '';
        const escapedTask = task ? task.replace(/'/g, "'\\''") : '';
        const taskArg = task ? ` --task='${escapedTask}'` : '';

        const getCmd = (action: string) => {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

            // 1. kanon-ag リポジトリ自体を開発・編集している場合（Kanon開発環境）
            const localDevPath = path.join(workspacePath, 'dist', 'cli', 'orchestrate.js');

            // 2. 一般のプロジェクトで npm install kanon-ag されている場合
            const localNpmPath = path.join(workspacePath, 'node_modules', '.bin', 'kanon');

            if (fs.existsSync(localDevPath)) {
                return `node --no-deprecation ./dist/cli/orchestrate.js ${action}`;
            } else if (fs.existsSync(localNpmPath)) {
                return `npx kanon ${action}`;
            } else {
                return `kanon ${action}`;
            }
        };

        switch (workflow) {
            case 'plan':
                cmd = getCmd(`plan${taskArg}`);
                break;
            case 'execute':
                cmd = getCmd(`execute`);
                break;
            case 'all':
                cmd = getCmd(`run${taskArg}`);
                break;
        }

        if (cmd) {
            taskTerminal.sendText('export NODE_NO_WARNINGS=1');
            taskTerminal.sendText(cmd);
        }
    }

    public runResumeSession() {
        if (!taskTerminal || taskTerminal.exitStatus) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            taskTerminal = vscode.window.createTerminal({
                name: 'Kanon Task Execution',
                cwd: workspaceFolder
            });
        }
        taskTerminal.show();

        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const localDevPath = path.join(workspacePath, 'dist', 'cli', 'orchestrate.js');
        const localNpmPath = path.join(workspacePath, 'node_modules', '.bin', 'kanon');

        let cmd: string;
        if (fs.existsSync(localDevPath)) {
            cmd = 'node --no-deprecation ./dist/cli/orchestrate.js resume';
        } else if (fs.existsSync(localNpmPath)) {
            cmd = 'npx kanon resume';
        } else {
            cmd = 'kanon resume';
        }

        taskTerminal.sendText('export NODE_NO_WARNINGS=1');
        taskTerminal.sendText(cmd);
    }

    private sendInterventionToCli(message: string) {
        if (cliWebSocket && cliWebSocket.readyState === WebSocket.OPEN) {
            cliWebSocket.send(JSON.stringify({ type: 'intervention', message }));
            vscode.window.showInformationMessage(`介入メッセージを送信しました: ${message}`);
        } else {
            vscode.window.showWarningMessage('CLIが接続されていません。');
        }
    }

    private sendStopToCli() {
        if (cliWebSocket && cliWebSocket.readyState === WebSocket.OPEN) {
            cliWebSocket.send(JSON.stringify({ type: 'stop' }));
            vscode.window.showInformationMessage('停止コマンドを送信しました。');
        } else {
            vscode.window.showWarningMessage('CLIが接続されていません。強制終了を試みます。');
            if (taskTerminal) {
                taskTerminal.dispose();
                taskTerminal = undefined;
            }
        }
    }

    private _getHtmlForWebview(webview: any) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' var(--vscode-font-family); script-src 'nonce-${nonce}'; connect-src ws://localhost:3001;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Kanon Dashboard</title>
            <style>
                :root {
                    --bg-color: var(--vscode-editor-background);
                    --text-color: var(--vscode-editor-foreground);
                    --border-color: var(--vscode-widget-border, #444);
                    --accent-color: var(--vscode-activityBarBadge-background, #007acc);
                    --accent-fg: var(--vscode-activityBarBadge-foreground, #fff);
                    --desc-color: var(--vscode-descriptionForeground, #888);
                    --success-color: #4CAF50;
                    --error-color: #F44336;
                    --warn-color: #FF9800;
                    --running-color: #2196F3;
                }
                * { box-sizing: border-box; }
                body {
                    font-family: var(--vscode-font-family);
                    padding: 0; margin: 0;
                    color: var(--text-color);
                    background-color: var(--bg-color);
                    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
                    font-size: 13px;
                }

                /* ==============================
                   Setup Overlay (Hero UI)
                ============================== */
                #setup-overlay {
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background: var(--bg-color);
                    display: none; flex-direction: column; align-items: center; justify-content: center;
                    z-index: 1000; padding: 20px; text-align: center;
                }
                .setup-card {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border: 1px solid var(--border-color);
                    padding: 24px; border-radius: 12px; max-width: 280px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                .setup-icon { font-size: 40px; margin-bottom: 12px; }
                .setup-title { font-size: 1.2em; font-weight: bold; margin-bottom: 8px; }
                .setup-desc { font-size: 0.9em; color: var(--desc-color); margin-bottom: 20px; line-height: 1.4; }
                .btn-setup {
                    background: var(--accent-color); color: var(--accent-fg);
                    border: none; padding: 10px 20px; border-radius: 6px;
                    font-weight: bold; cursor: pointer; font-size: 1em; width: 100%;
                }
                .btn-setup:hover { opacity: 0.9; }

                /* ==============================
                   Header / セッション情報
                ============================== */
                .header {
                    padding: 8px 12px 6px;
                    border-bottom: 1px solid var(--border-color);
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    flex-shrink: 0;
                }
                .header-top {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 4px;
                }
                .header h3 { margin: 0; font-size: 1em; letter-spacing: 0.05em; }
                .status-badge {
                    padding: 2px 8px; border-radius: 10px;
                    font-size: 0.75em; font-weight: bold;
                    display: flex; align-items: center; gap: 4px;
                }
                .status-connected { background-color: var(--success-color); color: white; }
                .status-disconnected { background-color: var(--error-color); color: white; }
                .status-reconnecting { background-color: var(--warn-color); color: white; }

                /* Setup Status */
                .init-badge {
                    padding: 2px 6px; border-radius: 4px; font-size: 0.7em;
                    font-weight: bold; margin-left: auto;
                }
                .init-ready { background: rgba(76,175,80,0.1); color: var(--success-color); border: 1px solid var(--success-color); }
                .init-pending { background: rgba(255,152,0,0.1); color: var(--warn-color); border: 1px solid var(--warn-color); }

                /* Session info */
                .session-info {
                    font-size: 0.75em;
                    color: var(--desc-color);
                    display: flex; flex-direction: column; gap: 1px;
                }
                .session-task {
                    font-size: 0.8em;
                    color: var(--text-color);
                    font-weight: 600;
                    margin-top: 2px;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .overall-status-badge {
                    display: inline-flex; align-items: center; gap: 4px;
                    padding: 1px 6px; border-radius: 10px; font-size: 0.7em; font-weight: bold;
                    margin-left: 6px;
                }
                .overall-idle { background: var(--border-color); color: var(--desc-color); }
                .overall-running { background: var(--running-color); color: white; }
                .overall-done { background: var(--success-color); color: white; }
                .overall-error { background: var(--error-color); color: white; }

                /* ==============================
                   Tabs
                ============================== */
                .tabs {
                    display: flex;
                    border-bottom: 1px solid var(--border-color);
                    background-color: var(--bg-color);
                    flex-shrink: 0;
                }
                .tab {
                    padding: 6px 12px;
                    cursor: pointer;
                    opacity: 0.6;
                    border-bottom: 2px solid transparent;
                    font-size: 0.85em; font-weight: 500;
                    transition: all 0.15s ease;
                }
                .tab:hover { opacity: 1; background-color: var(--vscode-list-hoverBackground); }
                .tab.active {
                    opacity: 1;
                    border-bottom: 2px solid var(--accent-color);
                    color: var(--vscode-textLink-foreground);
                }

                /* ==============================
                   エージェント ステータス表
                ============================== */
                #panel-state {
                    display: flex; flex-direction: column; flex: 1; overflow: hidden;
                }
                .agent-table {
                    padding: 8px 12px 4px;
                    border-bottom: 1px solid var(--border-color);
                    flex-shrink: 0;
                }
                .agent-table-title {
                    font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.08em;
                    color: var(--desc-color); margin-bottom: 4px;
                }
                .agent-rows { display: flex; flex-direction: column; gap: 2px; }
                .agent-row {
                    display: flex; align-items: center; gap: 8px;
                    padding: 3px 6px; border-radius: 4px;
                    transition: background 0.15s;
                    font-size: 0.85em;
                }
                .agent-row:hover { background: var(--vscode-list-hoverBackground); }
                .agent-dot {
                    width: 8px; height: 8px; border-radius: 50%;
                    flex-shrink: 0; transition: background 0.3s;
                }
                .dot-idle { background: var(--border-color); }
                .dot-running {
                    background: var(--running-color);
                    box-shadow: 0 0 0 2px rgba(33,150,243,0.3);
                    animation: pulse 1.5s infinite;
                }
                .dot-done { background: var(--success-color); }
                .dot-error { background: var(--error-color); }
                @keyframes pulse {
                    0%,100% { box-shadow: 0 0 0 2px rgba(33,150,243,0.3); }
                    50% { box-shadow: 0 0 0 5px rgba(33,150,243,0.1); }
                }
                .agent-name { font-weight: 600; min-width: 75px; }
                .agent-status-label {
                    font-size: 0.75em; padding: 1px 6px; border-radius: 8px;
                    background: var(--border-color); color: var(--desc-color);
                }
                .label-running { background: var(--running-color); color: white; }
                .label-done { background: var(--success-color); color: white; }
                .label-error { background: var(--error-color); color: white; }
                .agent-msg {
                    flex: 1; color: var(--desc-color); font-size: 0.8em;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }

                /* ==============================
                   アクティビティ一覧
                ============================== */
                #activity-list {
                    flex: 1; overflow-y: auto; padding: 8px 12px;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 0.82em;
                }
                .activity-section-title {
                    font-size: 0.65em; text-transform: uppercase; letter-spacing: 0.08em;
                    color: var(--desc-color); margin-bottom: 4px; font-family: var(--vscode-font-family);
                }
                .activity-entry {
                    display: flex; gap: 6px; align-items: flex-start;
                    margin-bottom: 4px; padding: 3px 5px;
                    border-radius: 3px; border-left: 3px solid transparent;
                    animation: fadeIn 0.25s ease;
                }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
                .act-time { color: var(--desc-color); white-space: nowrap; flex-shrink: 0; }
                .act-agent { font-weight: bold; min-width: 72px; flex-shrink: 0; }
                .act-msg { white-space: pre-wrap; word-wrap: break-word; flex: 1; }

                /* エージェント別左ボーダー色 */
                .agent-conductor { border-left-color: #569CD6; }
                .agent-architect { border-left-color: #C586C0; }
                .agent-developer { border-left-color: #CE9178; }
                .agent-qc, .agent-gatekeeper { border-left-color: #DCDCAA; }
                .agent-system { border-left-color: #666; }
                .agent-error-entry {
                    border-left-color: var(--error-color);
                    background: rgba(244,67,54,0.08);
                }
                .activity-entry.type-status {
                    background: rgba(78,201,176,0.08);
                    border-left-width: 4px;
                    font-weight: 600;
                }

                /* ==============================
                   ログ エリア（従来互換、Logsタブ用）
                ============================== */
                #panel-logs {
                    display: none; flex: 1; flex-direction: column; overflow: hidden;
                }
                #log-container {
                    flex: 1; overflow-y: auto; padding: 10px 12px;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 0.82em;
                }
                .log-entry {
                    margin-bottom: 6px; padding: 4px 5px;
                    border-radius: 3px; border-left: 3px solid transparent;
                    animation: fadeIn 0.25s ease;
                }
                .log-time { color: var(--desc-color); font-size: 0.8em; margin-right: 6px; }
                .log-agent { font-weight: bold; margin-right: 6px; display: inline-block; min-width: 75px; }
                .log-message { white-space: pre-wrap; word-wrap: break-word; }

                /* ==============================
                   Toolbar & チャット
                ============================== */
                .toolbar {
                    padding: 4px 8px;
                    background: var(--bg-color);
                    border-bottom: 1px solid var(--border-color);
                    display: flex; gap: 4px; overflow-x: auto;
                    flex-shrink: 0; align-items: center;
                }
                .tool-btn {
                    font-size: 0.78em; padding: 2px 8px;
                    background: transparent;
                    border: 1px solid var(--border-color);
                    color: var(--text-color);
                    cursor: pointer; border-radius: 10px;
                    white-space: nowrap;
                    transition: background 0.15s;
                }
                .tool-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
                .tool-btn-primary {
                    background: var(--accent-color); color: var(--accent-fg);
                    border-color: var(--accent-color); font-weight: bold;
                }
                .tool-btn-primary:hover { opacity: 0.85; }

                .updated-at {
                    flex-grow: 1; text-align: right;
                    font-size: 0.7em; color: var(--desc-color);
                }

                /* scrollbar */
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }

            </style>
        </head>
        <body>
            <!-- セットアップ オーバーレイ -->
            <div id="setup-overlay">
                <div class="setup-card">
                    <div class="setup-icon">🌌</div>
                    <div class="setup-title">Kanon Setup</div>
                    <div class="setup-desc">このプロジェクトでは Kanon オーケストレーターがまだ有効になっていません。</div>
                    <button class="btn-setup" id="btn-init-project">Initialize Project</button>
                    <p style="font-size: 0.7em; color: var(--desc-color); margin-top: 12px;">またはチャットで /orchestrate を実行</p>
                </div>
            </div>

            <!-- ヘッダー：セッション情報 -->
            <div class="header">
                <div class="header-top">
                    <h3>⚡ Kanon Dashboard</h3>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span id="init-status" class="init-badge init-pending">pending</span>
                        <span id="status" class="status-badge status-disconnected">Disconnected</span>
                    </div>
                </div>
                <div class="session-info">
                    <div>
                        <span id="session-id-label">セッション: --</span>
                        <span id="overall-status-badge" class="overall-status-badge overall-idle">idle</span>
                    </div>
                    <div id="session-task" class="session-task" title="">タスクなし</div>
                </div>
            </div>

            <!-- タブ -->
            <div class="tabs">
                <div class="tab active" data-target="state">状態</div>
                <div class="tab" data-target="logs">ログ</div>
            </div>

            <!-- Resume バナー -->
            <div id="resume-banner" style="display: none; background: var(--vscode-notificationsWarningIcon-foreground, #e6a23c); color: #fff; padding: 8px 12px; font-size: 0.9em; justify-content: space-between; align-items: center; margin-bottom: 8px; border-radius: 4px;">
                <span id="resume-banner-text" style="color: #000; font-weight: bold;">⚠️ 実行中で中断された可能性のあるセッションがあります。</span>
                <button id="btn-resume-session" style="background: rgba(0,0,0,0.3); border: none; color: white; cursor: pointer; padding: 4px 8px; border-radius: 4px; font-weight: bold;">再開する (Resume)</button>
            </div>

            <!-- Toolbar -->
            <div class="toolbar">
                <button class="tool-btn" id="btn-workflow-plan">📋 Plan</button>
                <button class="tool-btn" id="btn-workflow-execute">▶ Execute</button>
                <button class="tool-btn tool-btn-primary" id="btn-workflow-all">🚀 Run All</button>
                <button class="tool-btn" id="btn-clear">🗑 クリア</button>
                <button class="tool-btn" id="btn-stop" style="background: var(--error-color); color: white; border-color: var(--error-color); margin-left: auto;">🛑 Stop</button>
                <span class="updated-at" id="updated-at"></span>
            </div>

            <!-- 介入（Intervention）エリア -->
            <div id="intervention-area" style="padding: 8px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 6px; background: var(--vscode-editor-inactiveSelectionBackground);">
                <input type="text" id="intervention-input" placeholder="エージェントへ指示（口出し）..." style="flex: 1; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font-size: 0.85em;">
                <button class="tool-btn tool-btn-primary" id="btn-send-intervention">送信</button>
            </div>

            <!-- パネル: 状態（State） -->
            <div id="panel-state">
                <!-- エージェント ステータス表 -->
                <div class="agent-table">
                    <div class="agent-table-title">エージェント ステータス</div>
                    <div class="agent-rows" id="agent-rows">
                        <!-- JS で動的生成 -->
                    </div>
                </div>
                <!-- 最新アクティビティ -->
                <div id="activity-list">
                    <div class="activity-section-title">最新アクティビティ</div>
                    <div id="activity-entries"><!-- JS で動的生成 --></div>
                </div>
            </div>

            <!-- パネル: ログ（従来互換） -->
            <div id="panel-logs">
                <div id="log-container"></div>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                // ===== DOM参照 =====
                const statusEl = document.getElementById('status');
                const logContainer = document.getElementById('log-container');
                const tabs = document.querySelectorAll('.tab');
                const panelState = document.getElementById('panel-state');
                const panelLogs = document.getElementById('panel-logs');
                const agentRowsEl = document.getElementById('agent-rows');
                const activityEntriesEl = document.getElementById('activity-entries');
                const sessionIdLabel = document.getElementById('session-id-label');
                const sessionTaskEl = document.getElementById('session-task');
                const overallStatusBadge = document.getElementById('overall-status-badge');
                const updatedAtEl = document.getElementById('updated-at');
                const initStatusEl = document.getElementById('init-status');
                const setupOverlay = document.getElementById('setup-overlay');
                const btnInitProject = document.getElementById('btn-init-project');
                const resumeBanner = document.getElementById('resume-banner');
                const btnResumeSession = document.getElementById('btn-resume-session');

                let allLogs = [];
                let activeTab = 'state';
                // 現在のレンダリング済み状態（差分更新用）
                let renderedActivityCount = 0;

                // ===== タブ切り替え =====
                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        tabs.forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        activeTab = tab.dataset.target;
                        if (activeTab === 'state') {
                            panelState.style.display = 'flex';
                            panelLogs.style.display = 'none';
                        } else {
                            panelState.style.display = 'none';
                            panelLogs.style.display = 'flex';
                        }
                    });
                });

                // ===== 状態レンダリング =====

                /**
                 * バックエンドから受信した KanonState を DOM に反映する。
                 */
                function renderState(state) {
                    if (!state) return;

                    // セッション情報ヘッダー
                    if (sessionIdLabel) {
                        sessionIdLabel.textContent = state.sessionId
                            ? 'Session: ' + state.sessionId.slice(0, 12) + '…'
                            : 'セッション: --';
                    }
                    if (sessionTaskEl) {
                        const taskText = state.task || 'タスクなし';
                        sessionTaskEl.textContent = taskText;
                        sessionTaskEl.title = taskText;
                    }
                    if (overallStatusBadge) {
                        const statusMap = {
                            idle: { label: 'idle', cls: 'overall-idle' },
                            running: { label: '⚙ running', cls: 'overall-running' },
                            done: { label: '✔ done', cls: 'overall-done' },
                            error: { label: '✖ error', cls: 'overall-error' },
                        };
                        const info = statusMap[state.overallStatus] || statusMap.idle;
                        overallStatusBadge.textContent = info.label;
                        overallStatusBadge.className = 'overall-status-badge ' + info.cls;
                    }

                    // 更新時刻
                    if (updatedAtEl && state.lastUpdated) {
                        updatedAtEl.textContent = '更新: ' + new Date(state.lastUpdated).toLocaleTimeString();
                    }

                    // セットアップ状態の更新
                    if (initStatusEl && setupOverlay) {
                        if (state.isInitialized) {
                            initStatusEl.textContent = 'Ready';
                            initStatusEl.className = 'init-badge init-ready';
                            setupOverlay.style.display = 'none';
                        } else {
                            initStatusEl.textContent = 'Setup Needed';
                            initStatusEl.className = 'init-badge init-pending';
                            setupOverlay.style.display = 'flex';
                        }
                    }

                    // Resumeバナーの表示/非表示の更新
                    updateResumeBannerVisibility(state);

                    // エージェントステータス表
                    if (agentRowsEl && state.agents) {
                        agentRowsEl.innerHTML = '';
                        state.agents.forEach(agent => {
                            const dotClass = {
                                idle: 'dot-idle', running: 'dot-running',
                                done: 'dot-done', error: 'dot-error'
                            }[agent.status] || 'dot-idle';
                            const labelClass = {
                                running: 'label-running', done: 'label-done', error: 'label-error'
                            }[agent.status] || '';
                            const row = document.createElement('div');
                            row.className = 'agent-row';
                            row.innerHTML =
                                '<span class="agent-dot ' + dotClass + '"></span>' +
                                '<span class="agent-name">' + escHtml(agent.name) + '</span>' +
                                '<span class="agent-status-label ' + labelClass + '">' + agent.status + '</span>' +
                                '<span class="agent-msg">' + escHtml(agent.lastMessage || '') + '</span>';
                            agentRowsEl.appendChild(row);
                        });
                    }

                    // アクティビティ一覧（差分追記）
                    if (activityEntriesEl && state.activities) {
                        const newEntries = state.activities.slice(renderedActivityCount);
                        newEntries.forEach(act => {
                            activityEntriesEl.appendChild(buildActivityEntry(act));
                        });
                        renderedActivityCount = state.activities.length;
                        // 新規追記があればスクロール
                        if (newEntries.length > 0) {
                            const listEl = document.getElementById('activity-list');
                            if (listEl) listEl.scrollTop = listEl.scrollHeight;
                        }
                    }
                }

                function buildActivityEntry(act) {
                    const agentLower = (act.agent || '').toLowerCase();
                    let agentClass = 'agent-system';
                    if (agentLower.includes('conductor')) agentClass = 'agent-conductor';
                    else if (agentLower.includes('architect')) agentClass = 'agent-architect';
                    else if (agentLower.includes('developer')) agentClass = 'agent-developer';
                    else if (agentLower.includes('qc') || agentLower.includes('gatekeeper')) agentClass = 'agent-qc';
                    else if (agentLower.includes('error')) agentClass = 'agent-error-entry';

                    const typeClass = act.type === 'status' ? ' type-status' : '';
                    const timeStr = act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : '';

                    const el = document.createElement('div');
                    el.className = 'activity-entry ' + agentClass + typeClass;
                    el.innerHTML =
                        '<span class="act-time">[' + timeStr + ']</span>' +
                        '<span class="act-agent">' + escHtml(act.agent || '') + ':</span>' +
                        '<span class="act-msg">' + escHtml(act.message || '') + '</span>';
                    return el;
                }

                function escHtml(str) {
                    return String(str)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');
                }

                // ===== ログエリア（従来互換） =====

                function addLogData(data) {
                    allLogs.push(data);
                    appendLogToDom(data, true);
                }

                function appendLogToDom(log, autoScroll) {
                    const agentLower = (log.agent || '').toLowerCase();
                    let agentClass = 'agent-system';
                    if (agentLower.includes('conductor') || agentLower === 'antigravity') agentClass = 'agent-antigravity';
                    else if (agentLower.includes('architect')) agentClass = 'agent-gemini';
                    else if (agentLower.includes('developer')) agentClass = 'agent-opencode';
                    else if (agentLower.includes('qc') || agentLower.includes('gatekeeper')) agentClass = 'agent-gatekeeper';

                    const entry = document.createElement('div');
                    entry.className = 'log-entry ' + agentClass;
                    if (log.type === 'status') {
                        entry.style.backgroundColor = 'rgba(78, 201, 176, 0.1)';
                        entry.style.fontWeight = 'bold';
                        entry.style.borderLeftWidth = '5px';
                    }
                    if (agentLower.includes('error')) {
                        entry.style.borderLeftColor = '#F44336';
                        entry.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
                    }
                    const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
                    entry.innerHTML =
                        '<span class="log-time">[' + timeStr + ']</span>' +
                        '<span class="log-agent">' + escHtml(log.agent || '') + ':</span>' +
                        '<span class="log-message">' + escHtml(log.message || '') + '</span>';
                    logContainer.appendChild(entry);
                    if (autoScroll !== false) {
                        logContainer.scrollTop = logContainer.scrollHeight;
                    }
                }

                // ===== Toolbar =====
                const btnWorkflowPlan = document.getElementById('btn-workflow-plan');
                if (btnWorkflowPlan) {
                    btnWorkflowPlan.addEventListener('click', () => {
                        addLogData({ agent: 'info', message: 'Plan の実行にはAntigravityのチャットで /orchestrate を使用してください。', timestamp: new Date().toISOString() });
                    });
                }

                const btnWorkflowExecute = document.getElementById('btn-workflow-execute');
                if (btnWorkflowExecute) {
                    btnWorkflowExecute.addEventListener('click', () => {
                        vscode.postMessage({ command: 'runWorkflow', workflow: 'execute' });
                    });
                }

                const btnWorkflowAll = document.getElementById('btn-workflow-all');
                if (btnWorkflowAll) {
                    btnWorkflowAll.addEventListener('click', () => {
                        addLogData({ agent: 'info', message: 'Run All の実行にはAntigravityのチャットで /orchestrate を使用してください。', timestamp: new Date().toISOString() });
                    });
                }

                const btnClear = document.getElementById('btn-clear');
                if (btnClear) {
                    btnClear.addEventListener('click', () => {
                        if (logContainer) logContainer.innerHTML = '';
                        allLogs = [];
                        if (activityEntriesEl) activityEntriesEl.innerHTML = '';
                        renderedActivityCount = 0;
                    });
                }

                if (btnInitProject) {
                    btnInitProject.addEventListener('click', () => {
                        vscode.postMessage({ command: 'initProject' });
                    });
                }

                if (btnResumeSession) {
                    btnResumeSession.addEventListener('click', () => {
                        vscode.postMessage({ command: 'resumeSession' });
                        if (resumeBanner) resumeBanner.style.display = 'none';
                    });
                }

                // 介入メッセージの送信
                const btnSendIntervention = document.getElementById('btn-send-intervention');
                const interventionInput = document.getElementById('intervention-input');
                if (btnSendIntervention && interventionInput) {
                    const sendMsg = () => {
                        const message = interventionInput.value.trim();
                        if (message) {
                            vscode.postMessage({ command: 'sendIntervention', message });
                            interventionInput.value = '';
                        }
                    };
                    btnSendIntervention.addEventListener('click', sendMsg);
                    interventionInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') sendMsg();
                    });
                }

                // 停止コマンドの送信
                const btnStop = document.getElementById('btn-stop');
                if (btnStop) {
                    btnStop.addEventListener('click', () => {
                        vscode.postMessage({ command: 'stopOrchestration' });
                    });
                }

                // 現在の接続状態（connected / disconnected 等）
                let currentWsStatus = 'disconnected';
                let lastKnownOverallStatus = 'idle';

                // ================== Resume Banner 表示ロジック ==================
                function updateResumeBannerVisibility(state) {
                    if (!state) return;
                    if (!resumeBanner) return;

                    // CLIが接続されておらず(!state.isCliConnected)、かつ状態上は実行中(running)の場合にバナーを出す
                    if (state.overallStatus === 'running' && !state.isCliConnected) {
                        resumeBanner.style.display = 'flex';
                    } else {
                        resumeBanner.style.display = 'none';
                    }
                }
                // ================================================================

                // ===== WebSocket（指数バックオフ再接続）=====
                let ws = null;
                let reconnectTimer = null;
                let reconnectAttempts = 0;
                const MAX_BACKOFF_MS = 30000;
                const BASE_BACKOFF_MS = 1000;

                function getBackoffMs(attempts) {
                    // 指数バックオフ: 1s, 2s, 4s, 8s, 16s, 30s（上限）
                    return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts), MAX_BACKOFF_MS);
                }

                function scheduleReconnect() {
                    if (reconnectTimer !== null) return;
                    const delay = getBackoffMs(reconnectAttempts);
                    reconnectAttempts++;
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        connect();
                    }, delay);
                }

                function connect() {
                    if (ws !== null) return;
                    try {
                        ws = new WebSocket('ws://localhost:3001');

                        ws.onopen = () => {
                            updateStatus('connected');
                            reconnectAttempts = 0;
                        };

                        ws.onclose = () => {
                            updateStatus('reconnecting');
                            ws = null;
                            scheduleReconnect();
                        };

                        ws.onerror = (err) => {
                            console.error('WebSocket Error', err);
                        };

                        ws.onmessage = (event) => {
                            try {
                                const data = JSON.parse(event.data);

                                // 状態メッセージ（type: 'state'）の場合は renderState で反映
                                if (data.type === 'state' && data.state) {
                                    renderState(data.state);
                                    return;
                                }

                                // 従来の log メッセージ
                                addLogData(data);

                            } catch (e) {
                                console.error('WS parse error', e, event.data);
                            }
                        };
                    } catch (e) {
                        console.error('WebSocket init failed', e);
                        scheduleReconnect();
                    }
                }

                function updateStatus(state) {
                    currentWsStatus = state;
                    if (!statusEl) return;
                    if (state === 'connected') {
                        statusEl.textContent = 'Connected';
                        statusEl.className = 'status-badge status-connected';
                    } else if (state === 'reconnecting') {
                        const delay = getBackoffMs(reconnectAttempts);
                        statusEl.textContent = 'Reconnecting…';
                        statusEl.className = 'status-badge status-reconnecting';
                    } else {
                        statusEl.textContent = 'Disconnected';
                        statusEl.className = 'status-badge status-disconnected';
                    }
                }

                // 初期化
                updateStatus('disconnected');
                connect();

                // 拡張機能側からの postMessage を受け取る
                window.addEventListener('message', (event) => {
                    const msg = event.data;
                    if (msg && (msg.type === 'state' || msg.type === 'updateState') && msg.state) {
                        console.log('State updated from extension:', msg.type, msg.state.overallStatus);
                        renderState(msg.state);
                    }
                });

                // 拡張機能に「Webview 準備完了」を通知 → 初期状態を送り返してもらう
                vscode.postMessage({ command: 'ready' });

            </script>
        </body>
        </html>
        `;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
