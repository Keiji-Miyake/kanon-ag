import * as vscode from 'vscode';
import * as path from 'path';

let serverTerminal: vscode.Terminal | undefined;
let taskTerminal: vscode.Terminal | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Kanon Extension v0.0.11 Activated (Workflow UI)!');

    const provider = new KanonDashboardProvider(context.extensionUri);

    const vsWindow = vscode.window as any;
    if (vsWindow.registerWebviewViewProvider) {
        context.subscriptions.push(
            vsWindow.registerWebviewViewProvider(KanonDashboardProvider.viewType, provider));
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('kanon.hello', () => {
            vscode.window.showInformationMessage('Hello from Kanon Extension (v0.0.11)!');
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand('kanon.openDashboard', () => {
            vscode.commands.executeCommand('kanon.dashboard.focus');
        }));
}

export function deactivate() {
    if (serverTerminal) {
        serverTerminal.dispose();
    }
    if (taskTerminal) {
        taskTerminal.dispose();
    }
}

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
                case 'startServer':
                    this.startKanonServer();
                    break;
                case 'stopServer':
                    this.stopKanonServer();
                    break;
                case 'runWorkflow':
                    this.runWorkflow(data.workflow, data.task);
                    break;
                case 'chat':
                    // チャット送信をユーザーの利便性のために直接 runWorkflow('all') にマッピング
                    vscode.window.showInformationMessage('Kanon: チャット入力からオーケストレーションを開始します...');
                    this.runWorkflow('all', data.text);
                    break;
                case 'openChat':
                    vscode.window.showInformationMessage('Kanon: Opening Antigravity Agent Panel...');

                    const chatCommands = [
                        // Try Antigravity specific commands first
                        { cmd: 'antigravity.agentSidePanel.focus', args: undefined },
                        { cmd: 'antigravity.sendPromptToAgentPanel', args: data.text }, // Pass string directly to avoid [object Object]
                        { cmd: 'antigravity.agentPanel.open', args: undefined },
                        // Fallbacks
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

                            // If we just focused the panel (cmd 0), we might still need to send the text.
                            // Let's try to send the prompt using the specific command if the focus worked.
                            if (cmd === 'antigravity.agentSidePanel.focus' && data.text) {
                                try {
                                    await vscode.commands.executeCommand('antigravity.sendPromptToAgentPanel', data.text);
                                } catch (e) {
                                    // Ignore error, maybe text was sent another way or command doesn't exist
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

    public startKanonServer() {
        if (!serverTerminal) {
            // Target the user's current project space
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            serverTerminal = vscode.window.createTerminal({
                name: 'Kanon Server',
                cwd: workspaceFolder
            });
        }
        serverTerminal.show();

        // Find the absolute path to this plugin's bundled "orchestrate.js" 
        // fallback in case 'kanon' is not installed globally in the user's PATH.
        // Assuming this extension is at `kanon-cli-prototype/src/extension`
        // and orchestrate.js is at `kanon-cli-prototype/dist/orchestrate.js`
        const bundledOrchestratePath = vscode.Uri.joinPath(this._extensionUri, '..', '..', 'dist', 'orchestrate.js').fsPath;

        serverTerminal.sendText('echo "Starting Kanon Server..."');
        // 1. Try global 'kanon ui'
        // 2. Fallback to directly executing the bundled script
        serverTerminal.sendText('export NODE_NO_WARNINGS=1');
        serverTerminal.sendText(`kanon ui || node --no-deprecation "${bundledOrchestratePath}" ui`);
    }

    public stopKanonServer() {
        if (serverTerminal) {
            serverTerminal.dispose();
            serverTerminal = undefined;
        }
        if (taskTerminal) {
            taskTerminal.dispose();
            taskTerminal = undefined;
        }

        // F5リロード等で変数が飛んでも、VScode上に残存している同名ターミナルがあれば確実に強制終了する
        vscode.window.terminals.forEach(t => {
            if (t.name === 'Kanon Server' || t.name === 'Kanon Task Execution') {
                t.dispose();
            }
        });
    }

    public runWorkflow(workflow: string, task: string) {
        if (!serverTerminal) {
            this.startKanonServer();
        }

        // 実行用のターミナルを作成 または 再利用
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
                // rudimentary chaining
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
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' var(--vscode-font-family); script-src 'nonce-${nonce}'; connect-src ws://localhost:3001;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Kanon Dashboard</title>
            <style>
                :root {
                    --bg-color: var(--vscode-editor-background);
                    --text-color: var(--vscode-editor-foreground);
                    --border-color: var(--vscode-widget-border);
                    --accent-color: var(--vscode-activityBarBadge-background);
                    --accent-fg: var(--vscode-activityBarBadge-foreground);
                }
                body {
                    font-family: var(--vscode-font-family);
                    padding: 0; margin: 0;
                    color: var(--text-color);
                    background-color: var(--bg-color);
                    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
                }
                
                /* Header */
                .header {
                    padding: 10px 15px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex; justify-content: space-between; align-items: center;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    flex-shrink: 0;
                }
                .header h3 { margin: 0; font-size: 1.1em; }
                .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; }
                .status-connected { background-color: #4CAF50; color: white; }
                .status-disconnected { background-color: #F44336; color: white; }

                /* Tabs */
                .tabs {
                    display: flex;
                    border-bottom: 1px solid var(--border-color);
                    background-color: var(--vscode-editor-background);
                    flex-shrink: 0;
                }
                .tab {
                    padding: 10px 15px;
                    cursor: pointer;
                    opacity: 0.7;
                    border-bottom: 2px solid transparent;
                    font-weight: 500;
                }
                .tab:hover { opacity: 1; background-color: var(--vscode-list-hoverBackground); }
                .tab.active {
                    opacity: 1;
                    border-bottom: 2px solid var(--accent-color);
                    color: var(--vscode-textLink-foreground);
                }

                /* Log Area */
                #log-container {
                    flex-grow: 1;
                    overflow-y: auto;
                    padding: 15px;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 0.9em;
                    background-color: var(--vscode-editor-background);
                }
                .log-entry {
                    margin-bottom: 8px;
                    padding: 5px;
                    border-radius: 4px;
                    border-left: 3px solid transparent;
                    animation: fadeIn 0.3s ease;
                }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                
                .log-time { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-right: 8px; }
                .log-agent { font-weight: bold; margin-right: 8px; display: inline-block; min-width: 80px; }
                .log-message { white-space: pre-wrap; word-wrap: break-word; }

                /* Agent Colors */
                .agent-system { border-left-color: #888; color: #aaa; }
                .agent-antigravity { border-left-color: #569CD6; } /* Blue */
                .agent-kanon { border-left-color: #4EC9B0; } /* Teal */
                .agent-gemini { border-left-color: #C586C0; } /* Purple */
                .agent-opencode { border-left-color: #CE9178; } /* Orange */
                .agent-gatekeeper { border-left-color: #DCDCAA; } /* Yellow */
                .agent-error { border-left-color: #F44336; background-color: rgba(244, 67, 54, 0.1); }

                /* Chat Area */
                .chat-area {
                    padding: 10px;
                    border-top: 1px solid var(--border-color);
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    flex-shrink: 0;
                    display: flex; gap: 10px;
                }
                #chat-input {
                    flex-grow: 1;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 4px;
                }
                #chat-send {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                #chat-send:hover { background-color: var(--vscode-button-hoverBackground); }

                /* Workflow Toolbar (Optional, can be toggleable) */
                .toolbar {
                    padding: 5px 10px;
                    background-color: var(--vscode-editor-background);
                    border-bottom: 1px solid var(--border-color);
                    display: flex; gap: 5px; overflow-x: auto;
                    flex-shrink: 0;
                }
                .tool-btn {
                    font-size: 0.8em;
                    padding: 2px 8px;
                    background: transparent;
                    border: 1px solid var(--border-color);
                    color: var(--text-color);
                    cursor: pointer;
                    border-radius: 10px;
                }
                .tool-btn:hover { background-color: var(--vscode-toolbar-hoverBackground); }

            </style>
        </head>
        <body>
            <div class="header">
                <h3>Kanon Dashboard</h3>
                <span id="status" class="status-badge status-disconnected">Disconnected</span>
            </div>

            <div class="tabs">
                <div class="tab active" data-target="all">All</div>
                <div class="tab" data-target="conductor">Conductor</div>
                <div class="tab" data-target="architect">Architect</div>
                <div class="tab" data-target="developer">Developer</div>
                <div class="tab" data-target="qc">QC</div>
            </div>

            <!-- Quick Actions Toolbar -->
            <div class="toolbar">
                <button class="tool-btn" id="btn-workflow-plan">Plan</button>
                <button class="tool-btn" id="btn-workflow-execute">Execute</button>
                <button class="tool-btn" id="btn-workflow-all" style="background:var(--vscode-button-background); color:white; font-weight:bold;">Run All</button>
                <span class="toolbar-separator" style="margin: 0 5px; border-left: 1px solid var(--border-color);"></span>
                <button class="tool-btn" id="btn-start">Start Server</button>
                <button class="tool-btn" id="btn-stop">Stop Server</button>
                <button class="tool-btn" id="btn-clear">Clear Logs</button>
                <span style="flex-grow:1"></span>
                <span style="font-size:0.8em; color:var(--vscode-descriptionForeground); align-self:center;">Project: Active</span>
            </div>

            <div id="log-container">
                <!-- Logs go here -->
            </div>

            <div class="chat-area">
                <input type="text" id="chat-input" placeholder="タスクの内容を入力してRun PlanまたはSendを押してください...">
                <button id="chat-send">Send</button>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const statusEl = document.getElementById('status');
                const logContainer = document.getElementById('log-container');
                const chatInput = document.getElementById('chat-input');
                const chatSend = document.getElementById('chat-send');
                const tabs = document.querySelectorAll('.tab');

                let allLogs = [];
                let activeTab = 'all';

                // --- Tab Logic ---
                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        tabs.forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        activeTab = tab.dataset.target;
                        renderLogs();
                    });
                });

                function getRoleInfo(agentName) {
                    const lower = agentName.toLowerCase();
                    
                    // Exact Role Matching
                    if (lower === 'conductor') return { role: 'conductor', class: 'agent-antigravity' };
                    if (lower === 'architect') return { role: 'architect', class: 'agent-gemini' };
                    if (lower === 'developer') return { role: 'developer', class: 'agent-opencode' };
                    if (lower === 'qc' || lower === 'gatekeeper') return { role: 'qc', class: 'agent-gatekeeper' };

                    // System / Error / Legacy fallback
                    if (lower.includes('error')) return { role: 'all', class: 'agent-error' };
                    if (lower.includes('system')) return { role: 'all', class: 'agent-system' };
                    
                    // Default fallback
                    return { role: 'conductor', class: 'agent-system' }; 
                }

                // --- Rendering ---
                function renderLogs() {
                    logContainer.innerHTML = '';
                    
                    const filtered = allLogs.filter(log => {
                        if (activeTab === 'all') return true;
                        
                        // Map agent to role
                        const info = getRoleInfo(log.agent);
                        
                        if (activeTab === 'architect' && info.role === 'architect') return true;
                        if (activeTab === 'developer' && info.role === 'developer') return true;
                        if (activeTab === 'qc' && info.role === 'qc') return true;
                        if (activeTab === 'conductor' && info.role === 'conductor') return true;
                        
                        return false;
                    });

                    filtered.forEach(log => {
                        appendLogToDom(log, false); // Don't scroll yet
                    });
                    
                    logContainer.scrollTop = logContainer.scrollHeight;
                }

                function addLogData(data) {
                    allLogs.push(data);
                    if (shouldShow(data, activeTab)) {
                        appendLogToDom(data, true);
                    }
                }

                function shouldShow(log, tab) {
                    if (tab === 'all') return true;
                    const info = getRoleInfo(log.agent);
                    return info.role === tab;
                }

                function appendLogToDom(log, autoScroll) {
                    const info = getRoleInfo(log.agent);
                    const entry = document.createElement('div');
                    entry.className = 'log-entry ' + (info.class || '');
                    
                    // Status style
                    if (log.type === 'status') {
                        entry.style.backgroundColor = 'rgba(78, 201, 176, 0.1)';
                        entry.style.fontWeight = 'bold';
                        entry.style.borderLeftWidth = '5px';
                    }

                    const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
                    entry.innerHTML = '<span class="log-time">[' + timeStr + ']</span><span class="log-agent">' + log.agent + ':</span><span class="log-message">' + log.message + '</span>';

                    // If error, force style
                    if (log.agent.toLowerCase().includes('error')) {
                        entry.style.borderLeftColor = '#F44336';
                        entry.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
                    }

                    logContainer.appendChild(entry);
                    if (autoScroll !== false) {
                        logContainer.scrollTop = logContainer.scrollHeight;
                    }
                }

// --- Chat Logic ---
function sendMessage() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    // UIログにユーザー入力のエコーを追加
    const now = new Date().toISOString();
    const echoLog = { agent: 'User', message: text, timestamp: now };
    addLogData(echoLog);

    // Run All ボタンと同じ動作を実行
    vscode.postMessage({ command: 'chat', text: text });

    chatInput.value = '';
}

if (chatSend) chatSend.addEventListener('click', sendMessage);
if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

// --- Toolbar Actions ---
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

const btnStart = document.getElementById('btn-start');
if (btnStart) {
    btnStart.addEventListener('click', () => { vscode.postMessage({ command: 'startServer' }); });
}

const btnStop = document.getElementById('btn-stop');
if (btnStop) {
    btnStop.addEventListener('click', () => { vscode.postMessage({ command: 'stopServer' }); });
}

const btnClear = document.getElementById('btn-clear');
if (btnClear) {
    btnClear.addEventListener('click', () => {
        if (logContainer) logContainer.innerHTML = '';
        allLogs = [];
    });
}

// --- WebSocket ---
let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

function connect() {
    if (ws !== null) return;

    try {
        ws = new WebSocket('ws://localhost:3001');

        ws.onopen = () => {
            updateStatus(true);
            addLogData({ agent: 'system', message: 'Connected to Kanon Orchestrator', timestamp: new Date().toISOString() });
            reconnectAttempts = 0;
            if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
        };

        ws.onclose = () => {
            updateStatus(false);
            ws = null;
            if (!reconnectTimer) { 
                reconnectTimer = setInterval(() => {
                    reconnectAttempts++;
                    // 指数バックオフ的な簡易待ち
                    if (reconnectAttempts > 30) { // 1.5分以上失敗し続けたら間隔を広げる
                        clearInterval(reconnectTimer);
                        reconnectTimer = setInterval(connect, 10000);
                    }
                    connect();
                }, 3000); 
            }
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // Check if this is a special action message embedded in a log
                if (data.message && typeof data.message === 'string' && data.message.includes('"action":"openChat"')) {
                    try {
                        const actionData = JSON.parse(data.message);
                        if (actionData.type === 'action' && actionData.action === 'openChat') {
                            vscode.postMessage({ command: 'openChat', text: actionData.text });
                            addLogData({ agent: 'system', message: 'Triggered UI Chat Panel for final report.', timestamp: data.timestamp });
                            return;
                        }
                    } catch (e) {
                        // Ignore parse error for non-action messages
                    }
                }

                addLogData(data);
            } catch (e) {
                console.error('WS parse error', e, event.data);
            }
        };

        ws.onerror = (err) => {
            // Error itself doesn't provide much info in browser WS, onclose will handle reconnect
            console.error('WebSocket Error', err);
        };
    } catch (e) {
        console.error('WebSocket init failed', e);
    }
}

function updateStatus(connected) {
    if (statusEl) {
        if (connected) {
            statusEl.textContent = 'Connected';
            statusEl.className = 'status-badge status-connected';
        } else {
            statusEl.textContent = 'Disconnected';
            statusEl.className = 'status-badge status-disconnected';
        }
    }
}

addLogData({ agent: 'system', message: 'Dashboard initialized.', timestamp: new Date().toISOString() });
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
