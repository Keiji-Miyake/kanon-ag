#!/usr/bin/env node
/**
 * Memory Manager — メモリバンク管理ユーティリティ
 *
 * .memories/ ディレクトリ内の構造化状態ファイルを管理する。
 * Orchestrator がセッション全体を制御し、各スキルが自身の進捗を記録する。
 *
 * Usage:
 *   npx ts-node memory-manager.ts --test
 *   npx ts-node memory-manager.ts --init <sessionId>
 *   npx ts-node memory-manager.ts --status
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ─── Constants ──────────────────────────────────────────────

const MEMORIES_DIR = '.memories';
const PROGRESS_DIR = path.join(MEMORIES_DIR, 'progress');
const RESULTS_DIR = path.join(MEMORIES_DIR, 'results');

// ─── Types ──────────────────────────────────────────────────

export interface SessionInfo {
    id: string;
    status: 'initializing' | 'running' | 'completed' | 'failed';
    phase: string;
    command?: string;      // 実行中のコマンド (e.g. 'plan', 'execute', 'run')
    targetTask?: string;   // 対象タスク名
    startedAt: string;
    updatedAt: string;
    workspace: string;
    currentPassage?: string; // 現在の Passage
    worktreePath?: string;   // ワークツリーの絶対パス
}

export interface TaskEntry {
    skill: string;
    cli: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'retrying';
    turns: number;
    startedAt: string | null;
    completedAt: string | null;
    pid: number | null;
    retryCount: number;
}

export interface ProgressEntry {
    turn: number;
    timestamp: string;
    content: string;
}

export interface ResultData {
    skill: string;
    status: 'success' | 'failure';
    summary: string;
    artifacts: string[];
    elapsedMs: number;
    turns: number;
}

export interface MetricsData {
    sessionId: string;
    startedAt: string;
    completedAt: string | null;
    skills: Record<string, {
        elapsedMs: number;
        turns: number;
        retries: number;
        status: string;
    }>;
}

// ─── Directory Management ───────────────────────────────────

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getBaseDir(workspace?: string): string {
    return workspace || process.env.KANON_MEMORIES_BASE || process.cwd();
}

function resolveMemoriesPath(basePath?: string): string {
    const base = getBaseDir(basePath);
    return path.join(base, MEMORIES_DIR);
}

// ─── Session Management ─────────────────────────────────────

export function initSession(sessionId: string, workspace?: string): SessionInfo {
    const base = getBaseDir(workspace);
    const memoriesDir = path.join(base, MEMORIES_DIR);
    const historyDir = path.join(base, '.memories-history');

    // 既存のセッションがあれば履歴にアーカイブ
    if (fs.existsSync(memoriesDir)) {
        try {
            const jsonPath = path.join(memoriesDir, 'session.json');
            if (fs.existsSync(jsonPath)) {
                const oldSession = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                if (oldSession && oldSession.id && oldSession.id !== sessionId) {
                    ensureDir(historyDir);
                    const archivePath = path.join(historyDir, oldSession.id);
                    if (!fs.existsSync(archivePath)) {
                        fs.cpSync(memoriesDir, archivePath, { recursive: true });
                    }
                }
            }
        } catch (e) {
            // アーカイブ失敗時は無視して続行
        }
    }

    ensureDir(memoriesDir);
    ensureDir(path.join(base, PROGRESS_DIR));
    ensureDir(path.join(base, RESULTS_DIR));

    const session: SessionInfo = {
        id: sessionId,
        status: 'initializing',
        phase: 'init',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workspace: base,
    };

    saveSession(session, base);

    // 空の task-board を作成
    updateTaskBoard([], base);

    // 空の metrics を作成
    const metrics: MetricsData = {
        sessionId,
        startedAt: session.startedAt,
        completedAt: null,
        skills: {},
    };
    fs.writeFileSync(
        path.join(memoriesDir, 'metrics.json'),
        JSON.stringify(metrics, null, 2),
        'utf-8',
    );

    return session;
}

function saveSession(session: SessionInfo, workspace?: string): void {
    const base = getBaseDir(workspace);
    const memoriesDir = path.join(base, MEMORIES_DIR);
    
    // JSON 保存 (Source of Truth)
    fs.writeFileSync(path.join(memoriesDir, 'session.json'), JSON.stringify(session, null, 2), 'utf-8');
    
    // Markdown 保存 (Human Readable)
    fs.writeFileSync(path.join(memoriesDir, 'session.md'), formatSessionMd(session), 'utf-8');
}

export function updateSession(
    status: SessionInfo['status'],
    phase: string,
    workspace?: string,
    command?: string,
    targetTask?: string,
    currentPassage?: string,
    worktreePath?: string,
): void {
    const base = getBaseDir(workspace);
    const session = readSession(base);
    
    if (!session) {
        throw new Error(`セッションが初期化されていません: ${base}`);
    }

    session.status = status;
    session.phase = phase;
    if (command !== undefined) session.command = command;
    if (targetTask !== undefined) session.targetTask = targetTask;
    if (currentPassage !== undefined) session.currentPassage = currentPassage;
    if (worktreePath !== undefined) session.worktreePath = worktreePath;
    session.updatedAt = new Date().toISOString();

    saveSession(session, base);
}

export function readSession(workspace?: string): SessionInfo | null {
    const base = getBaseDir(workspace);
    const jsonPath = path.join(base, MEMORIES_DIR, 'session.json');

    if (!fs.existsSync(jsonPath)) {
        return null;
    }
    
    const session: SessionInfo = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    // ステイル（古い）セッション検出: 30分以上 running のままなら failed とみなす
    if (session.status === 'running' || session.status === 'initializing') {
        const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30分
        const updatedAt = new Date(session.updatedAt).getTime();
        const now = Date.now();
        if (!isNaN(updatedAt) && (now - updatedAt) > STALE_THRESHOLD_MS) {
            try {
                session.status = 'failed';
                session.updatedAt = new Date().toISOString();
                saveSession(session, base);
            } catch (_) { /* ignore */ }
        }
    }

    return session;
}

// ─── Task Board ─────────────────────────────────────────────

export function updateTaskBoard(tasks: TaskEntry[], workspace?: string): void {
    const base = getBaseDir(workspace);
    const memoriesDir = path.join(base, MEMORIES_DIR);
    ensureDir(memoriesDir);

    // JSON 保存
    fs.writeFileSync(path.join(memoriesDir, 'task-board.json'), JSON.stringify(tasks, null, 2), 'utf-8');
    
    // Markdown 保存
    fs.writeFileSync(path.join(memoriesDir, 'task-board.md'), formatTaskBoardMd(tasks), 'utf-8');
}

export function readTaskBoard(workspace?: string): TaskEntry[] {
    const base = getBaseDir(workspace);
    const jsonPath = path.join(base, MEMORIES_DIR, 'task-board.json');

    if (!fs.existsSync(jsonPath)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
}

// ─── Progress ───────────────────────────────────────────────

export function appendProgress(
    skill: string,
    turn: number,
    content: string,
    workspace?: string,
): void {
    const base = getBaseDir(workspace);
    const progressDir = path.join(base, PROGRESS_DIR);
    ensureDir(progressDir);

    const filePath = path.join(progressDir, `${skill}.md`);

    const entry: ProgressEntry = {
        turn,
        timestamp: new Date().toISOString(),
        content,
    };

    const line = `\n### Turn ${entry.turn} (${entry.timestamp})\n\n${entry.content}\n`;

    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, line, 'utf-8');
    } else {
        const header = `# Progress: ${skill}\n${line}`;
        fs.writeFileSync(filePath, header, 'utf-8');
    }
}

export function readProgress(skill: string, workspace?: string): string | null {
    const base = getBaseDir(workspace);
    const filePath = path.join(base, PROGRESS_DIR, `${skill}.md`);

    if (!fs.existsSync(filePath)) {
        return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
}

// ─── Results ────────────────────────────────────────────────

export function writeResult(skill: string, data: ResultData, workspace?: string): void {
    const base = getBaseDir(workspace);
    const resultsDir = path.join(base, RESULTS_DIR);
    ensureDir(resultsDir);

    const filePath = path.join(resultsDir, `${skill}.md`);
    const content = formatResultMd(data);
    fs.writeFileSync(filePath, content, 'utf-8');
}

export function readResult(skill: string, workspace?: string): string | null {
    const base = getBaseDir(workspace);
    const filePath = path.join(base, RESULTS_DIR, `${skill}.md`);

    if (!fs.existsSync(filePath)) {
        return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
}

// ─── Metrics ────────────────────────────────────────────────

export function updateMetrics(
    skill: string,
    data: { elapsedMs: number; turns: number; retries: number; status: string },
    workspace?: string,
): void {
    const base = getBaseDir(workspace);
    const metricsPath = path.join(base, MEMORIES_DIR, 'metrics.json');

    let metrics: MetricsData;
    if (fs.existsSync(metricsPath)) {
        metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    } else {
        metrics = {
            sessionId: 'unknown',
            startedAt: new Date().toISOString(),
            completedAt: null,
            skills: {},
        };
    }

    metrics.skills[skill] = data;
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf-8');
}

export function readMetrics(workspace?: string): MetricsData | null {
    const base = getBaseDir(workspace);
    const metricsPath = path.join(base, MEMORIES_DIR, 'metrics.json');

    if (!fs.existsSync(metricsPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
}

// ─── Cleanup ────────────────────────────────────────────────

export function cleanMemories(workspace?: string): void {
    const base = workspace || process.cwd();
    const memoriesDir = path.join(base, MEMORIES_DIR);

    if (fs.existsSync(memoriesDir)) {
        fs.rmSync(memoriesDir, { recursive: true, force: true });
    }
}

// ─── Markdown Formatters ────────────────────────────────────

function formatSessionMd(session: SessionInfo): string {
    const statusIcon = {
        initializing: '🔄',
        running: '▶️',
        completed: '✅',
        failed: '❌',
    }[session.status];

    return `# Session: ${session.id}

| 項目 | 値 |
|------|-----|
| **ステータス** | ${statusIcon} ${session.status} |
| **フェーズ** | ${session.phase} |
| **コマンド** | ${session.command || '-'} |
| **対象タスク** | ${session.targetTask || '-'} |
| **現在の Passage** | ${session.currentPassage || '-'} |
| **ワークツリー** | ${session.worktreePath || '-'} |
| **開始** | ${session.startedAt} |
| **更新** | ${session.updatedAt} |
| **ワークスペース** | ${session.workspace} |
`;
}


function formatTaskBoardMd(tasks: TaskEntry[]): string {
    let md = `# Task Board\n\n`;
    md += `| Skill | CLI | Status | Turns | Started | Completed | PID | Retries |\n`;
    md += `|-------|-----|--------|-------|---------|-----------|-----|--------|\n`;

    const statusIcons: Record<string, string> = {
        pending: '⏳',
        running: '🔄',
        done: '✅',
        failed: '❌',
        retrying: '🔁',
    };

    for (const task of tasks) {
        const icon = statusIcons[task.status] || '❓';
        md += `| ${task.skill} | ${task.cli} | ${icon} ${task.status} | ${task.turns} | ${task.startedAt || '-'} | ${task.completedAt || '-'} | ${task.pid ?? '-'} | ${task.retryCount} |\n`;
    }

    md += `\n_Updated: ${new Date().toISOString()}_\n`;
    return md;
}

function parseTaskBoardMd(content: string): TaskEntry[] {
    const lines = content.split('\n');
    const tasks: TaskEntry[] = [];
function formatResultMd(data: ResultData): string {
    const icon = data.status === 'success' ? '✅' : '❌';
    const elapsed = formatElapsed(data.elapsedMs);

    let md = `# Result: ${data.skill}\n\n`;
    md += `| 項目 | 値 |\n`;
    md += `|------|-----|\n`;
    md += `| **ステータス** | ${icon} ${data.status} |\n`;
    md += `| **所要時間** | ${elapsed} |\n`;
    md += `| **ターン数** | ${data.turns} |\n\n`;
    md += `## サマリー\n\n${data.summary}\n\n`;

    if (data.artifacts.length > 0) {
        md += `## 成果物\n\n`;
        for (const artifact of data.artifacts) {
            md += `- ${artifact}\n`;
        }
    }

    return md;
}

function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
}

// ─── Self-Test ──────────────────────────────────────────────

async function selfTest(): Promise<void> {
    const testDir = path.join(process.cwd(), '.test-memories-workspace');

    console.log('\n═══════════════════════════════════════════');
    console.log('  🧪 Memory Manager Self-Test');
    console.log('═══════════════════════════════════════════\n');

    try {
        // Cleanup previous test
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testDir, { recursive: true });

        // Test 1: initSession
        console.log('  [1/8] initSession...');
        const session = initSession('test-session-001', testDir);
        assert(session.id === 'test-session-001', 'セッションID一致');
        assert(session.status === 'initializing', 'ステータス一致');
        assert(
            fs.existsSync(path.join(testDir, MEMORIES_DIR, 'session.md')),
            'session.md 存在',
        );
        assert(
            fs.existsSync(path.join(testDir, MEMORIES_DIR, 'task-board.md')),
            'task-board.md 存在',
        );
        assert(
            fs.existsSync(path.join(testDir, MEMORIES_DIR, 'metrics.json')),
            'metrics.json 存在',
        );
        console.log('  ✅ initSession OK');

        // Test 2: readSession
        console.log('  [2/8] readSession...');
        const readBack = readSession(testDir);
        assert(readBack !== null, 'セッション読み取り成功');
        assert(readBack!.id === 'test-session-001', 'ID一致');
        assert(readBack!.status === 'initializing', 'ステータス一致');
        console.log('  ✅ readSession OK');

        // Test 3: updateSession
        console.log('  [3/8] updateSession...');
        updateSession('running', 'implement', testDir);
        const updated = readSession(testDir);
        assert(updated!.status === 'running', '更新後ステータス一致');
        assert(updated!.phase === 'implement', '更新後フェーズ一致');
        console.log('  ✅ updateSession OK');

        // Test 4: updateTaskBoard + readTaskBoard
        console.log('  [4/8] updateTaskBoard + readTaskBoard...');
        const tasks: TaskEntry[] = [
            {
                skill: 'conductor',
                cli: 'gemini',
                status: 'done',
                turns: 5,
                startedAt: '2026-02-11T12:00:00Z',
                completedAt: '2026-02-11T12:02:15Z',
                pid: 12345,
                retryCount: 0,
            },
            {
                skill: 'architect',
                cli: 'copilot',
                status: 'running',
                turns: 8,
                startedAt: '2026-02-11T12:02:20Z',
                completedAt: null,
                pid: 12346,
                retryCount: 0,
            },
            {
                skill: 'developer',
                cli: 'gemini',
                status: 'pending',
                turns: 0,
                startedAt: null,
                completedAt: null,
                pid: null,
                retryCount: 0,
            },
        ];
        updateTaskBoard(tasks, testDir);
        const readTasks = readTaskBoard(testDir);
        assert(readTasks.length === 3, 'タスク数一致');
        assert(readTasks[0].skill === 'conductor', '1番目のスキル一致');
        assert(readTasks[0].status === 'done', '1番目のステータス一致');
        assert(readTasks[1].status === 'running', '2番目のステータス一致');
        assert(readTasks[2].pid === null, '3番目のPIDがnull');
        console.log('  ✅ updateTaskBoard + readTaskBoard OK');

        // Test 5: appendProgress + readProgress
        console.log('  [5/8] appendProgress + readProgress...');
        appendProgress('conductor', 1, 'AGENTS.md を確認中', testDir);
        appendProgress('conductor', 2, 'プロジェクト計画を作成完了', testDir);
        const progress = readProgress('conductor', testDir);
        assert(progress !== null, '進捗読み取り成功');
        assert(progress!.includes('Turn 1'), 'Turn 1 存在');
        assert(progress!.includes('Turn 2'), 'Turn 2 存在');
        assert(progress!.includes('AGENTS.md を確認中'), '内容一致');
        console.log('  ✅ appendProgress + readProgress OK');

        // Test 6: writeResult + readResult
        console.log('  [6/8] writeResult + readResult...');
        writeResult(
            'conductor',
            {
                skill: 'conductor',
                status: 'success',
                summary: 'プロジェクト計画を正常に完了',
                artifacts: ['AGENTS.md', 'docs/ROADMAP.md'],
                elapsedMs: 135000,
                turns: 5,
            },
            testDir,
        );
        const result = readResult('conductor', testDir);
        assert(result !== null, '結果読み取り成功');
        assert(result!.includes('success'), 'ステータス一致');
        assert(result!.includes('2m 15s'), '所要時間フォーマット一致');
        console.log('  ✅ writeResult + readResult OK');

        // Test 7: updateMetrics + readMetrics
        console.log('  [7/8] updateMetrics + readMetrics...');
        updateMetrics(
            'conductor',
            { elapsedMs: 135000, turns: 5, retries: 0, status: 'success' },
            testDir,
        );
        const metrics = readMetrics(testDir);
        assert(metrics !== null, 'メトリクス読み取り成功');
        assert(metrics!.skills['conductor'].turns === 5, 'ターン数一致');
        console.log('  ✅ updateMetrics + readMetrics OK');

        // Test 8: cleanMemories
        console.log('  [8/8] cleanMemories...');
        cleanMemories(testDir);
        assert(
            !fs.existsSync(path.join(testDir, MEMORIES_DIR)),
            '.memories/ 削除済み',
        );
        console.log('  ✅ cleanMemories OK');

        console.log('\n═══════════════════════════════════════════');
        console.log('  🎉 全テスト合格 (8/8)');
        console.log('═══════════════════════════════════════════\n');
    } finally {
        // Cleanup
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    }
}

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`❌ アサーション失敗: ${message}`);
    }
}

// ─── CLI ────────────────────────────────────────────────────

function showStatus(): void {
    const session = readSession();
    if (!session) {
        console.log('  ℹ️  アクティブなセッションがありません');
        return;
    }

    console.log(`\n  Session: ${session.id}`);
    console.log(`  Status:  ${session.status}`);
    console.log(`  Phase:   ${session.phase}`);
    console.log(`  Started: ${session.startedAt}\n`);

    const tasks = readTaskBoard();
    if (tasks.length > 0) {
        console.log('  Task Board:');
        for (const task of tasks) {
            const icon = { pending: '⏳', running: '🔄', done: '✅', failed: '❌', retrying: '🔁' }[task.status] || '❓';
            console.log(`    ${icon} ${task.skill} (${task.cli}) — ${task.status} [${task.turns} turns]`);
        }
    }
    console.log('');
}

function main(): void {
    const args = process.argv.slice(2);

    if (args.includes('--test')) {
        selfTest().catch((e) => {
            console.error(`\n  ❌ テスト失敗: ${(e as Error).message}\n`);
            process.exit(1);
        });
        return;
    }

    if (args.includes('--status')) {
        showStatus();
        return;
    }

    const initArg = args.find((a) => a.startsWith('--init'));
    if (initArg) {
        const sessionIdArg = args[args.indexOf(initArg) + 1];
        const sessionId = sessionIdArg || `session-${Date.now()}`;
        const session = initSession(sessionId);
        console.log(`  ✅ セッション初期化完了: ${session.id}`);
        console.log(`  📁 ${resolveMemoriesPath()}`);
        return;
    }

    console.log(`
  Memory Manager — メモリバンク管理ユーティリティ

  Usage:
    npx ts-node memory-manager.ts --test          セルフテスト実行
    npx ts-node memory-manager.ts --init [id]     セッション初期化
    npx ts-node memory-manager.ts --status        現在のステータス表示
`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    main();
}
