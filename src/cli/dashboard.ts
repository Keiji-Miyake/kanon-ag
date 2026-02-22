#!/usr/bin/env node
/**
 * Dashboard — ターミナルダッシュボード
 *
 * .memories/ を監視し、エージェント実行状況をリアルタイム表示する。
 * ANSI エスケープシーケンスで罫線付きテーブルを描画。
 *
 * Usage:
 *   npx ts-node dashboard.ts                             通常起動
 *   npx ts-node dashboard.ts --memories-dir <path>       ディレクトリ指定
 *   npx ts-node dashboard.ts --test                      セルフテスト
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import { WebSocket } from 'ws';

// ─── Types ──────────────────────────────────────────────────

export interface DashboardConfig {
    memoriesDir: string;
    refreshMs: number;
}

interface SkillRow {
    skill: string;
    cli: string;
    status: string;
    statusIcon: string;
    turns: number;
    elapsed: string;
    lastMessage: string;
}

interface SessionData {
    id: string;
    status: string;
    phase: string;
}

// ─── ANSI Colors ────────────────────────────────────────────

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',

    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',

    // Backgrounds
    bgBlack: '\x1b[40m',
    bgBlue: '\x1b[44m',
    bgCyan: '\x1b[46m',

    // Control
    clearScreen: '\x1b[2J',
    cursorHome: '\x1b[H',
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h',
    enterAltScreen: '\x1b[?1049h',
    exitAltScreen: '\x1b[?1049l',
};

// ─── Box Drawing Characters ─────────────────────────────────

const BOX = {
    topLeft: '╔', topRight: '╗', bottomLeft: '╚', bottomRight: '╝',
    horizontal: '═', vertical: '║',
    tDown: '╤', tUp: '╧', tRight: '╠', tLeft: '╣',
    cross: '╪',
    thinH: '─', thinV: '│',
};

// ─── Log Stream Logic ───────────────────────────────────────

class LogStream {
    private filePath: string;
    private lastSize: number = 0;

    constructor(filePath: string) {
        this.filePath = filePath;
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            this.lastSize = stat.size;
        }
    }

    /**
     * 増分を読み込む
     */
    readNewLines(): string[] {
        if (!fs.existsSync(this.filePath)) return [];

        try {
            const stat = fs.statSync(this.filePath);

            // ファイルが縮小していたら（リセットされたら）最初から読む
            if (stat.size < this.lastSize) {
                this.lastSize = 0;
            }

            if (stat.size === this.lastSize) {
                return [];
            }

            const bufferSize = stat.size - this.lastSize;
            const buffer = Buffer.alloc(bufferSize);
            const fd = fs.openSync(this.filePath, 'r');
            fs.readSync(fd, buffer, 0, bufferSize, this.lastSize);
            fs.closeSync(fd);

            this.lastSize = stat.size;

            return buffer.toString('utf-8').split('\n');
        } catch (e) {
            return []; // I/O エラーは無視
        }
    }
}

class LogManager {
    private streams: Map<string, LogStream> = new Map();
    private logs: string[] = [];
    private maxLogs: number = 1000;
    private progressDir: string;

    // スキルごとの色割り当て
    private skillColors: Record<string, string> = {};
    private colorPalette = [ANSI.cyan, ANSI.magenta, ANSI.blue, ANSI.yellow, ANSI.green];
    private nextColorIdx = 0;

    constructor(memoriesDir: string) {
        this.progressDir = path.join(memoriesDir, 'progress');
    }

    check(): string[] {
        if (!fs.existsSync(this.progressDir)) return this.logs;

        // 新しいスキルファイルを検出
        const files = fs.readdirSync(this.progressDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const skill = path.basename(file, '.md');
            if (!this.streams.has(skill)) {
                this.streams.set(skill, new LogStream(path.join(this.progressDir, file)));

                // 色を割り当て
                if (!this.skillColors[skill]) {
                    this.skillColors[skill] = this.colorPalette[this.nextColorIdx % this.colorPalette.length];
                    this.nextColorIdx++;
                }
            }
        }

        // 各ストリームから新しい行を取得
        for (const [skill, stream] of this.streams.entries()) {
            const lines = stream.readNewLines();
            for (const line of lines) {
                const trimmed = line.trim();
                // 空行やヘッダーだけの行はスキップ（見やすくするため）
                if (!trimmed) continue;

                this.addLog(skill, trimmed);
            }
        }

        return this.logs;
    }

    private addLog(skill: string, content: string) {
        const time = new Date().toLocaleTimeString('ja-JP');
        const color = this.skillColors[skill] || ANSI.white;
        // Turn ヘッダーなどは少し薄くする
        const isHeader = content.startsWith('## Turn') || content.startsWith('# ');

        let formatted = '';
        if (isHeader) {
            formatted = `${ANSI.dim}[${time}]${ANSI.reset} ${color}${ANSI.bold}[${skill}]${ANSI.reset} ${ANSI.dim}${content}${ANSI.reset}`;
        } else {
            formatted = `${ANSI.dim}[${time}]${ANSI.reset} ${color}[${skill}]${ANSI.reset} ${content}`;
        }

        this.logs.push(formatted);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    }

    getLogs(): string[] {
        return this.logs;
    }
}

// ─── Interaction ────────────────────────────────────────────

export type KanonMessage =
    | { type: 'identify', clientType: 'dashboard' | 'cli' | 'webview' }
    | { type: 'intervention', message: string }
    | { type: 'stop' }
    | { type: 'thought', content: string }
    | { type: 'status', status: string, agent: string };

export class DashboardInteraction {
    private ws: WebSocket | null = null;
    private url: string;
    private onMessageHandler?: (data: KanonMessage) => void;

    constructor(url?: string) {
        const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3001;
        this.url = url || `ws://localhost:${WS_PORT}`;
    }

    onMessage(handler: (data: KanonMessage) => void): void {
        this.onMessageHandler = handler;
    }

    async connect(): Promise<boolean> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return true;

        return new Promise((resolve) => {
            try {
                // console.log(`Connecting to ${this.url}...`);
                this.ws = new WebSocket(this.url);

                const timeout = setTimeout(() => {
                    if (this.ws) {
                        this.ws.terminate();
                        this.ws = null;
                    }
                    resolve(false);
                }, 2000);

                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    this.ws?.send(JSON.stringify({ type: 'identify', clientType: 'dashboard' }));
                    resolve(true);
                });

                this.ws.on('message', (data) => {
                    if (this.onMessageHandler) {
                        try {
                            const parsed = JSON.parse(data.toString());
                            this.onMessageHandler(parsed);
                        } catch (e) {
                            // Ignore non-JSON or malformed
                        }
                    }
                });

                this.ws.on('error', (_err) => {
                    clearTimeout(timeout);
                    this.ws = null;
                    resolve(false);
                });

                this.ws.on('close', () => {
                    this.ws = null;
                });
            } catch (e) {
                resolve(false);
            }
        });
    }

    async sendIntervention(message: string): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'intervention', message }));
        }
    }

    async sendStop(): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'stop' }));
        }
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// ─── Rendering ──────────────────────────────────────────────

/**
 * ダッシュボード画面を文字列として生成
 */
export function renderDashboard(
    session: SessionData,
    rows: SkillRow[],
    logs: string[],
    width: number = 70,
    height: number = 24,
): string {
    const lines: string[] = [];
    const innerWidth = width - 2;

    // ─── Header ─────────────────────────────
    lines.push(`${ANSI.cyan}${BOX.topLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.topRight}${ANSI.reset}`);

    const title = '🎼 Agent Skills Orchestrator';
    const titlePadding = Math.max(0, innerWidth - visualLength(title) - 2);
    lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset}  ${ANSI.bold}${title}${ANSI.reset}${' '.repeat(titlePadding)}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);

    const statusLine = `Session: ${session.id}  Status: ${session.status}  Phase: ${session.phase}`;
    const statusPadding = Math.max(0, innerWidth - visualLength(statusLine) - 2);
    lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset}  ${ANSI.dim}${statusLine}${ANSI.reset}${' '.repeat(statusPadding)}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);

    // ─── Table Header ───────────────────────
    const cols = [14, 10, 12, 7, 10];
    const headers = ['Skill', 'CLI', 'Status', 'Turns', 'Elapsed'];

    const sumCols = cols.reduce((a, b) => a + b, 0);
    const numGaps = cols.length - 1;
    const tableInternalWidth = sumCols + numGaps + 2;
    const tablePadding = Math.max(0, innerWidth - tableInternalWidth);

    // 区切り線
    const separatorParts = cols.map(w => BOX.horizontal.repeat(w));
    const sepLine = separatorParts.join(BOX.tDown);
    const gapFill = ' '.repeat(tablePadding);
    const horizFill = BOX.horizontal.repeat(tablePadding);

    lines.push(`${ANSI.cyan}${BOX.tRight}${sepLine}${horizFill}${BOX.tLeft}${ANSI.reset}`);

    // ヘッダー行
    const headerRow = headers.map((h, i) => padCell(h, cols[i])).join(`${ANSI.dim}${BOX.thinV}${ANSI.reset}`);
    lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset} ${ANSI.bold}${headerRow}${ANSI.reset}${gapFill} ${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);

    // ヘッダー下区切り
    const thinSep = cols.map(w => BOX.thinH.repeat(w));
    const thinSepLine = thinSep.join('┼');
    lines.push(`${ANSI.cyan}${BOX.tRight}${thinSepLine}${BOX.thinH.repeat(tablePadding)}${BOX.tLeft}${ANSI.reset}`);

    // ─── Data Rows ──────────────────────────
    if (rows.length === 0) {
        const emptyMsg = '  エージェント未起動...';
        lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset}${ANSI.dim}${emptyMsg}${' '.repeat(innerWidth - visualLength(emptyMsg))}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);
    } else {
        for (const row of rows) {
            const statusColor = getStatusColor(row.status);
            const cells = [
                padCell(row.skill, cols[0]),
                padCell(row.cli, cols[1]),
                `${statusColor}${padCell(`${row.statusIcon} ${row.status}`, cols[2])}${ANSI.reset}`,
                padCell(row.turns > 0 ? String(row.turns) : '-', cols[3]),
                padCell(row.elapsed || '-', cols[4]),
            ];
            const rowContent = cells.join(`${ANSI.dim}${BOX.thinV}${ANSI.reset}`);
            lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset} ${rowContent}${gapFill} ${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);
        }
    }

    // ─── Logs Section ───────────────────────
    lines.push(`${ANSI.cyan}${BOX.tRight}${BOX.horizontal.repeat(innerWidth)}${BOX.tLeft}${ANSI.reset}`);
    lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset}  ${ANSI.bold}Thinking Logs:${ANSI.reset}${' '.repeat(Math.max(0, innerWidth - 14))}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);
    lines.push(`${ANSI.cyan}${BOX.tRight}${BOX.thinH.repeat(innerWidth)}${BOX.tLeft}${ANSI.reset}`);

    // 残りの高さを計算 (Header 3 + TableHeader 3 + Rows + LogHeader 2 + Footer 2)
    const fixedLines = 3 + 3 + Math.max(1, rows.length) + 2 + 2;
    const logHeight = Math.max(5, height - fixedLines); // 最低5行は確保

    const visibleLogs = logs.slice(-logHeight);

    // 足りない行を空白で埋める
    for (let i = 0; i < logHeight; i++) {
        if (i < visibleLogs.length) {
            const logLine = visibleLogs[i];
            // 表示長さを計算して右側をスペース埋め
            const contentLen = visualLength(logLine);
            // const padding = Math.max(0, innerWidth - contentLen - 1); // unused

            // 行が長すぎる場合は切り詰める
            let displayLine = logLine;
            if (contentLen > innerWidth - 2) {
                // 簡易切り詰め (詳細なANSI対応切り詰めは複雑なので省略)
                displayLine = logLine.substring(0, innerWidth - 5) + '...';
            }

            lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset} ${displayLine}${' '.repeat(Math.max(0, innerWidth - visualLength(displayLine) - 1))}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);
        } else {
            lines.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);
        }
    }

    // ─── Footer ─────────────────────────────
    lines.push(`${ANSI.cyan}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.bottomRight}${ANSI.reset}`);

    const now = new Date().toLocaleTimeString('ja-JP');
    lines.push(`${ANSI.dim}  最終更新: ${now}  |  [i] 介入  [s] 停止  [Ctrl+C] 終了${ANSI.reset}`);

    return lines.join('\n');
}

/**
 * 文字列の表示幅を取得（サロゲートペア対応）
 */
function visualLength(str: string): number {
    let length = 0;
    for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i);
        // ANSI エスケープシーケンスを無視
        if (charCode === 0x1B) {
            while (i < str.length && str[i] !== 'm') i++;
            continue;
        }
        // サロゲートペア (絵文字など)
        if (charCode >= 0xD800 && charCode <= 0xDBFF) {
            length += 2;
            i++;
        } else if (charCode > 255) {
            length += 2; // 全角
        } else {
            length += 1; // 半角
        }
    }
    return length;
}

function padCell(text: string, width: number): string {
    const vLen = visualLength(text);
    if (vLen >= width) {
        return text.slice(0, width);
    }
    return text + ' '.repeat(width - vLen);
}

function getStatusColor(status: string): string {
    switch (status.toLowerCase()) {
        case 'done':
        case 'completed':
        case '完了': return ANSI.green;
        case 'running':
        case '実行中': return ANSI.yellow;
        case 'waiting':
        case '待機中': return ANSI.dim;
        case 'failed':
        case '失敗': return ANSI.red;
        case 'timeout':
        case 'タイムアウト': return ANSI.red;
        default: return ANSI.white;
    }
}

// ─── Data Loading ───────────────────────────────────────────

function loadSession(memoriesDir: string): SessionData {
    const sessionPath = path.join(memoriesDir, 'session.md');
    if (!fs.existsSync(sessionPath)) {
        return { id: '-', status: '未起動', phase: '-' };
    }

    const content = fs.readFileSync(sessionPath, 'utf-8');
    const getField = (label: string): string => {
        const regex = new RegExp(`\\*\\*${label}\\*\\*\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, 'm');
        const match = content.match(regex);
        return match ? match[1].trim().replace(/^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}\uFE0F\u200D]+\s*/u, '') : '-';
    };

    const idMatch = content.match(/^# Session: (.+)$/m);

    return {
        id: idMatch ? idMatch[1].trim() : '-',
        status: getField('ステータス'),
        phase: getField('フェーズ'),
    };
}

function loadSkillRows(memoriesDir: string): SkillRow[] {
    const rows: SkillRow[] = [];
    const cliMap = loadCliMapping(memoriesDir);
    const progressDir = path.join(memoriesDir, 'progress');
    const resultsDir = path.join(memoriesDir, 'results');
    const progressSkills = fs.existsSync(progressDir)
        ? fs.readdirSync(progressDir).filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md'))
        : [];

    const completedSkills = fs.existsSync(resultsDir)
        ? new Set(fs.readdirSync(resultsDir).filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md')))
        : new Set<string>();

    const metricsMap = loadMetrics(memoriesDir);

    for (const skill of progressSkills) {
        const progressPath = path.join(progressDir, `${skill}.md`);
        const content = fs.readFileSync(progressPath, 'utf-8');
        const turns = (content.match(/^## Turn \d+/gm) || []).length;
        const isCompleted = completedSkills.has(skill);
        const metrics = metricsMap[skill];

        rows.push({
            skill,
            cli: cliMap[skill] || 'gemini',
            status: isCompleted ? 'Done' : 'Running',
            statusIcon: isCompleted ? '✅' : '🔄',
            turns,
            elapsed: metrics?.elapsed || formatElapsed(fs.statSync(progressPath)),
            lastMessage: extractLastTurn(content),
        });
    }
    return rows;
}

function extractLastTurn(content: string): string {
    const turns = content.split(/^(?=## Turn \d+)/m);
    if (turns.length === 0) return '';
    let last = turns[turns.length - 1].trim();
    last = last.replace(/^## Turn \d+.*?\n/, '').trim();
    last = last.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    return last;
}

function loadCliMapping(memoriesDir: string): Record<string, string> {
    const taskBoardPath = path.join(memoriesDir, 'task-board.md');
    if (!fs.existsSync(taskBoardPath)) return {};
    const content = fs.readFileSync(taskBoardPath, 'utf-8');
    const map: Record<string, string> = {};
    const rows = content.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
    for (const row of rows.slice(1)) {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
            map[cells[0]] = cells[1];
        }
    }
    return map;
}

interface MetricsData {
    skills?: Record<string, { durationMs?: number }>;
}

function loadMetrics(memoriesDir: string): Record<string, { elapsed: string }> {
    const metricsPath = path.join(memoriesDir, 'metrics.json');
    if (!fs.existsSync(metricsPath)) return {};
    try {
        const data = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as MetricsData;
        const result: Record<string, { elapsed: string }> = {};
        if (data.skills) {
            for (const [skill, info] of Object.entries(data.skills)) {
                result[skill] = { elapsed: info.durationMs ? formatMs(info.durationMs) : '-' };
            }
        }
        return result;
    } catch { return {}; }
}

function formatElapsed(stat: fs.Stats): string {
    const elapsed = Date.now() - stat.mtimeMs;
    return formatMs(elapsed);
}

function formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return `${min}m ${sec}s`;
    const hour = Math.floor(min / 60);
    return `${hour}h ${min % 60}m`;
}

// ─── Live Dashboard ─────────────────────────────────────────

async function startLiveDashboard(config: DashboardConfig): Promise<void> {
    process.stdout.write(ANSI.enterAltScreen + ANSI.hideCursor + ANSI.clearScreen + ANSI.cursorHome);
    const logManager = new LogManager(config.memoriesDir);
    const interaction = new DashboardInteraction();

    // 定期的に接続を試みる
    setInterval(() => interaction.connect(), 2000);
    await interaction.connect();

    // キーボード入力を有効にする
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    let isIntervening = false;
    let refreshInterval: NodeJS.Timeout | null = null;

    const refresh = () => {
        if (isIntervening) return;

        const session = loadSession(config.memoriesDir);
        const rows = loadSkillRows(config.memoriesDir);
        const logs = logManager.check();

        const termWidth = process.stdout.columns || 80;
        const termHeight = process.stdout.rows || 24;

        const output = renderDashboard(session, rows, logs, Math.min(termWidth, 80), termHeight);

        // 画面全体を消さず、カーソルをホームに戻して上書きすることでチラつきを抑える
        process.stdout.write(ANSI.cursorHome + output);
    };

    const startRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        refresh();
        refreshInterval = setInterval(refresh, config.refreshMs);
    };

    startRefresh();

    process.stdin.on('keypress', async (_str, key) => {
        if (key.ctrl && key.name === 'c') {
            if (refreshInterval) clearInterval(refreshInterval);
            interaction.disconnect();
            process.stdout.write(ANSI.showCursor + ANSI.exitAltScreen);
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            console.log('\n  👋 ダッシュボード終了\n');
            process.exit(0);
        }

        if (isIntervening) return;

        if (key.name === 's') {
            await interaction.sendStop();
            // 一時的に停止メッセージを表示
            process.stdout.write('\n\x1b[31m[Stop requested via dashboard]\x1b[0m\n');
        } else if (key.name === 'i') {
            isIntervening = true;
            if (refreshInterval) clearInterval(refreshInterval);

            console.log(ANSI.showCursor);
            if (process.stdin.isTTY) process.stdin.setRawMode(false);

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            process.stdout.write('\n🎤 介入メッセージを入力してください: ');

            rl.question('', async (message) => {
                const trimmed = message.trim();
                if (trimmed) {
                    await interaction.sendIntervention(trimmed);
                    process.stdout.write(`\n✅ 送信完了: ${trimmed}\n`);
                }
                rl.close();
            });

            rl.on('close', () => {
                isIntervening = false;
                if (process.stdin.isTTY) process.stdin.setRawMode(true);
                console.log(ANSI.hideCursor);
                startRefresh();
            });
        }
    });
}

// ─── Self-Test ──────────────────────────────────────────────

function selfTest(): void {
    console.log('\n═══════════════════════════════════════════');
    console.log('  🧪 Dashboard Self-Test');
    console.log('═══════════════════════════════════════════\n');

    let passed = 0;
    let total = 0;
    function assert(condition: boolean, message: string): void {
        total++;
        if (condition) { console.log(`  ✅ ${message}`); passed++; } else { console.log(`  ❌ ${message}`); }
    }

    // Test 1: renderDashboard
    console.log('  [1/2] renderDashboard...');
    const logs = [
        '[12:00:01] [conductor] Planning started.',
        '[12:00:02] [conductor] Analyzing requirements...',
        '[12:00:03] [architect] Designing system...',
    ];
    const output = renderDashboard(
        { id: 'test-123', status: 'RUNNING', phase: 'Phase 1' },
        [],
        logs,
        70,
        20
    );
    assert(output.includes('Thinking Logs:'), 'Log section header');
    assert(output.includes('Designing system'), 'Log content visible');

    // Test 2: LogStream (Basic)
    console.log('\n  [2/2] LogStream...');
    const testFile = 'test-log.md';
    fs.writeFileSync(testFile, 'Line 1\n');
    const stream = new LogStream(testFile);
    // 初期状態では全読み込みしない設計なら空、または末尾からなら空。
    // 実装ではコンストラクタで lastSize を取得しているので、新規追加分だけ読まれるはず。

    fs.appendFileSync(testFile, 'Line 2\nLine 3\n');
    const newLines = stream.readNewLines();
    assert(newLines.length >= 2, 'Read new lines');
    assert(newLines.includes('Line 2'), 'Content match');

    fs.unlinkSync(testFile);

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  ${passed === total ? '🎉' : '⚠️'} テスト結果: ${passed}/${total} 合格`);
    console.log('═══════════════════════════════════════════\n');
    process.exit(passed === total ? 0 : 1);
}

// ─── Main ───────────────────────────────────────────────────

export async function runDashboard(): Promise<void> {
    const args = process.argv.slice(2);
    // サブコマンドとして呼ばれた場合 (kanon dashboard ...) は argv のオフセットが変わる可能性があるが、
    // ここでは単純に --test や --memories-dir を探す。
    if (args.includes('--test')) {
        selfTest();
        return;
    }
    const dirIdx = args.indexOf('--memories-dir');
    const memoriesDir = (dirIdx !== -1 && args[dirIdx + 1]) ? args[dirIdx + 1] : path.join(process.cwd(), '.memories');
    await startLiveDashboard({ memoriesDir, refreshMs: 1000 });
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
    runDashboard().catch(console.error);
}
