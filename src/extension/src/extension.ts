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
};

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
            const taskMatch = content.match(/(?:task:|## Task:|タスク:)\s*(.+)/i);
            if (taskMatch) {
                updates.task = taskMatch[1].trim();
            }
            // 開始時刻をパース
            const startedMatch = content.match(/(?:startedAt:|started:|開始:|## Started:)\s*(.+)/i);
            if (startedMatch) {
                updates.startedAt = startedMatch[1].trim();
            }
            // 状態をパース
            const statusMatch = content.match(/(?:status:|## Status:|状態:)\s*(.+)/i);
            if (statusMatch) {
                const rawStatus = statusMatch[1].trim().toLowerCase();
                if (rawStatus.includes('run') || rawStatus.includes('実行')) {
                    updates.overallStatus = 'running';
                } else if (rawStatus.includes('done') || rawStatus.includes('完了')) {
                    updates.overallStatus = 'done';
                } else if (rawStatus.includes('error') || rawStatus.includes('エラー')) {
                    updates.overallStatus = 'error';
                } else {
                    updates.overallStatus = 'idle';
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

    return updates;
}

/**
 * 現在のワークスペースの .memories/ を監視・解析して状態を更新し、
 * 全接続クライアントにブロードキャストする。
 */
function broadcastState() {
    const stateMsg = JSON.stringify({
        type: 'state',
        state: currentState,
        timestamp: new Date().toISOString(),
    });

    if (wss) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(stateMsg);
            }
        });
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

    // 初期状態をロード
    const initialUpdates = parseMemoriesToState(memoriesDir);
    currentState = { ...currentState, ...initialUpdates, lastUpdated: new Date().toISOString() };

    if (fileWatcher) {
        fileWatcher.close();
    }

    fileWatcher = chokidar.watch(memoriesDir, {
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
        currentState = { ...currentState, ...updates, lastUpdated: new Date().toISOString() };
        broadcastState();
    };

    fileWatcher
        .on('add', onFileChange)
        .on('change', onFileChange)
        .on('unlink', onFileChange)
        .on('error', (err) => console.error('[Kanon] chokidar エラー:', err));

    console.log(`[Kanon] .memories/ 監視開始: ${memoriesDir}`);
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
    console.log('Kanon Extension v0.2.0 Activated (State Sync + File Watch)!');

    // 拡張機能起動時に WebSocket サーバーとファイル監視を自動起動
    startEmbeddedServer();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        startFileWatcher(workspaceRoot);
    }

    // ワークスペースフォルダが変わったときも再起動
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            stopFileWatcher();
            const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (newRoot) {
                startFileWatcher(newRoot);
            }
        })
    );

    const provider = new KanonDashboardProvider(context.extensionUri);

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
        console.log('[Kanon] クライアント接続');

        // 接続直後に現在の状態全体をクライアントに送信（状態復元）
        ws.send(JSON.stringify({
            type: 'state',
            state: currentState,
            timestamp: new Date().toISOString(),
        }));

        ws.on('close', () => {
            console.log('[Kanon] クライアント切断');
        });

        ws.on('message', (message) => {
            const data = message.toString();
            // CLI からのログを全接続クライアント（ダッシュボード UI）にブロードキャスト
            // また、ログメッセージを activities に追記してステート更新もする
            try {
                const parsed = JSON.parse(data);
                // 既存の text ログ互換処理を維持
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
                }
            } catch (_e) {
                // JSON でない場合は無視
            }

            wss!.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(data);
                }
            });
            // 更新された状態をブロードキャスト
            broadcastState();
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

    public resolveWebviewView(
        webviewView: any,
        _context: any,
        _token: any,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((data: any) => {
            switch (data.command) {
                case 'runWorkflow':
                    this.runWorkflow(data.workflow, data.task);
                    break;
                case 'chat':
                    vscode.window.showInformationMessage('Kanon: チャット入力からオーケストレーションを開始します...');
                    this.runWorkflow('all', data.text);
                    break;
                case 'openChat':
                    vscode.window.showInformationMessage('Kanon: Opening Antigravity Agent Panel...');

                    const chatCommands = [
                        { cmd: 'antigravity.agentSidePanel.focus', args: undefined },
                        { cmd: 'antigravity.sendPromptToAgentPanel', args: data.text },
                        { cmd: 'antigravity.agentPanel.open', args: undefined },
                        { cmd: 'workbench.action.chat.open', args: { query: data.text } },
                        { cmd: 'workbench.panel.chat.view.copilot.focus', args: undefined }
                    ];

                    const tryCommand = async (index: number) => {
                        if (index >= chatCommands.length) {
                            vscode.window.showErrorMessage('Failed to open Antigravity chat panel.');
                            return;
                        }
                        const { cmd, args } = chatCommands[index];
                        try {
                            if (args) {
                                await vscode.commands.executeCommand(cmd, args);
                            } else {
                                await vscode.commands.executeCommand(cmd);
                            }
                            console.log(`Successfully opened chat with command: ${cmd}`);

                            if (cmd === 'antigravity.agentSidePanel.focus' && data.text) {
                                try {
                                    await vscode.commands.executeCommand('antigravity.sendPromptToAgentPanel', data.text);
                                } catch (e) {
                                    // コマンドが存在しない場合は無視
                                }
                            }
                        } catch (err) {
                            console.log(`Command ${cmd} failed, trying next...`);
                            await tryCommand(index + 1);
                        }
                    };

                    tryCommand(0);
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

        const bundledOrchestratePath = vscode.Uri.joinPath(this._extensionUri, '..', '..', 'dist', 'orchestrate.js').fsPath;
        let cmd = '';
        const taskArg = task ? ` --task="${task.replace(/"/g, '\\"')}"` : '';

        switch (workflow) {
            case 'plan':
                cmd = `kanon plan${taskArg} || node --no-deprecation "${bundledOrchestratePath}" plan${taskArg}`;
                break;
            case 'execute':
                cmd = `kanon execute || node --no-deprecation "${bundledOrchestratePath}" execute`;
                break;
            case 'all':
                cmd = `kanon run${taskArg} || node --no-deprecation "${bundledOrchestratePath}" run${taskArg}`;
                break;
        }

        if (cmd) {
            taskTerminal.sendText('export NODE_NO_WARNINGS=1');
            taskTerminal.sendText(cmd);
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

                .chat-area {
                    padding: 8px;
                    border-top: 1px solid var(--border-color);
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    flex-shrink: 0;
                    display: flex; gap: 6px;
                }
                #chat-input {
                    flex-grow: 1; padding: 6px 8px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 4px; font-size: 0.88em;
                }
                #chat-send {
                    padding: 6px 14px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none; border-radius: 4px;
                    cursor: pointer; font-size: 0.88em;
                    transition: background 0.15s;
                }
                #chat-send:hover { background: var(--vscode-button-hoverBackground); }

                /* scrollbar */
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }

            </style>
        </head>
        <body>
            <!-- ヘッダー：セッション情報 -->
            <div class="header">
                <div class="header-top">
                    <h3>⚡ Kanon Dashboard</h3>
                    <span id="status" class="status-badge status-disconnected">Disconnected</span>
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

            <!-- Toolbar -->
            <div class="toolbar">
                <button class="tool-btn" id="btn-workflow-plan">📋 Plan</button>
                <button class="tool-btn" id="btn-workflow-execute">▶ Execute</button>
                <button class="tool-btn tool-btn-primary" id="btn-workflow-all">🚀 Run All</button>
                <button class="tool-btn" id="btn-clear">🗑 クリア</button>
                <span class="updated-at" id="updated-at"></span>
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

            <!-- チャット入力 -->
            <div class="chat-area">
                <input type="text" id="chat-input" placeholder="タスクの内容を入力して Run All または Send…">
                <button id="chat-send">Send</button>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                // ===== DOM参照 =====
                const statusEl = document.getElementById('status');
                const logContainer = document.getElementById('log-container');
                const chatInput = document.getElementById('chat-input');
                const chatSend = document.getElementById('chat-send');
                const tabs = document.querySelectorAll('.tab');
                const panelState = document.getElementById('panel-state');
                const panelLogs = document.getElementById('panel-logs');
                const agentRowsEl = document.getElementById('agent-rows');
                const activityEntriesEl = document.getElementById('activity-entries');
                const sessionIdLabel = document.getElementById('session-id-label');
                const sessionTaskEl = document.getElementById('session-task');
                const overallStatusBadge = document.getElementById('overall-status-badge');
                const updatedAtEl = document.getElementById('updated-at');

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

                // ===== チャット =====
                function sendMessage() {
                    if (!chatInput) return;
                    const text = chatInput.value.trim();
                    if (!text) return;
                    const now = new Date().toISOString();
                    addLogData({ agent: 'User', message: text, timestamp: now });
                    vscode.postMessage({ command: 'chat', text: text });
                    chatInput.value = '';
                }

                if (chatSend) chatSend.addEventListener('click', sendMessage);
                if (chatInput) {
                    chatInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') sendMessage();
                    });
                }

                // ===== Toolbar =====
                const btnWorkflowPlan = document.getElementById('btn-workflow-plan');
                if (btnWorkflowPlan) {
                    btnWorkflowPlan.addEventListener('click', () => {
                        const task = chatInput ? chatInput.value.trim() : '';
                        if (!task) {
                            addLogData({ agent: 'error', message: 'Planを実行するには、タスクの内容(プロンプト)を入力してください。', timestamp: new Date().toISOString() });
                            if (chatInput) chatInput.focus();
                            return;
                        }
                        vscode.postMessage({ command: 'runWorkflow', workflow: 'plan', task: task });
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
                        const task = chatInput ? chatInput.value.trim() : '';
                        if (!task) {
                            addLogData({ agent: 'error', message: 'Run Allを実行するには、タスクの内容(プロンプト)を入力してください。', timestamp: new Date().toISOString() });
                            if (chatInput) chatInput.focus();
                            return;
                        }
                        vscode.postMessage({ command: 'runWorkflow', workflow: 'all', task: task });
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

                                // 状態メッセージ（type: 'state'）の場合は renderState で описат
                                if (data.type === 'state' && data.state) {
                                    renderState(data.state);
                                    return;
                                }

                                // openChat アクション
                                if (data.message && typeof data.message === 'string' && data.message.includes('"action":"openChat"')) {
                                    try {
                                        const actionData = JSON.parse(data.message);
                                        if (actionData.type === 'action' && actionData.action === 'openChat') {
                                            vscode.postMessage({ command: 'openChat', text: actionData.text });
                                            return;
                                        }
                                    } catch (e) { /* 非アクションメッセージは無視 */ }
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
