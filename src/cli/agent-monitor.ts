#!/usr/bin/env node
/**
 * Agent Monitor — .memories/ ファイル監視 + タスクボード自動更新
 *
 * .memories/ ディレクトリを監視し、エージェントの進捗変化を検知する。
 * agent-spawner と memory-manager を橋渡しし、タスクボードとメトリクスを自動更新。
 *
 * Usage:
 *   npx ts-node agent-monitor.ts --test    セルフテスト
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ─── Types ──────────────────────────────────────────────────

export interface MonitorConfig {
    /** 監視間隔（ms） */
    pollIntervalMs: number;
    /** .memories/ ディレクトリパス */
    memoriesDir: string;
}

export interface SkillProgress {
    skill: string;
    turns: number;
    lastUpdate: string;
    lastContent: string;
}

export interface MonitorSnapshot {
    timestamp: string;
    skills: SkillProgress[];
    completedSkills: string[];
    failedSkills: string[];
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
    pollIntervalMs: 5000,
    memoriesDir: path.join(process.cwd(), '.memories'),
};

// ─── Core Functions ─────────────────────────────────────────

/**
 * progress/ ディレクトリから全スキルの進捗を収集
 */
export function collectProgress(memoriesDir: string): SkillProgress[] {
    const progressDir = path.join(memoriesDir, 'progress');
    if (!fs.existsSync(progressDir)) return [];

    const files = fs.readdirSync(progressDir).filter(f => f.endsWith('.md'));
    return files.map(file => {
        const skill = path.basename(file, '.md');
        const content = fs.readFileSync(path.join(progressDir, file), 'utf-8');
        const turns = countTurns(content);
        const stat = fs.statSync(path.join(progressDir, file));
        const lastContent = extractLastTurn(content);

        return {
            skill,
            turns,
            lastUpdate: stat.mtime.toISOString(),
            lastContent,
        };
    });
}

/**
 * results/ ディレクトリから完了スキルを取得
 */
export function collectResults(memoriesDir: string): string[] {
    const resultsDir = path.join(memoriesDir, 'results');
    if (!fs.existsSync(resultsDir)) return [];
    return fs.readdirSync(resultsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => path.basename(f, '.md'));
}

/**
 * 現在のスナップショットを生成
 */
export function takeSnapshot(memoriesDir: string): MonitorSnapshot {
    const skills = collectProgress(memoriesDir);
    const completedSkills = collectResults(memoriesDir);

    // 結果がなく、進捗も更新されていないスキルを失敗候補とする
    // （実際の失敗判定は agent-spawner 側で行う）
    const failedSkills: string[] = [];

    return {
        timestamp: new Date().toISOString(),
        skills,
        completedSkills,
        failedSkills,
    };
}

/**
 * 2つのスナップショットの差分を検出
 */
export function diffSnapshots(
    prev: MonitorSnapshot,
    current: MonitorSnapshot,
): SnapshotDiff {
    const prevSkills = new Map(prev.skills.map(s => [s.skill, s]));

    const newSkills: string[] = [];
    const updatedSkills: string[] = [];
    const newlyCompleted: string[] = [];

    for (const skill of current.skills) {
        const prevSkill = prevSkills.get(skill.skill);
        if (!prevSkill) {
            newSkills.push(skill.skill);
        } else if (skill.turns > prevSkill.turns || skill.lastUpdate !== prevSkill.lastUpdate) {
            updatedSkills.push(skill.skill);
        }
    }

    for (const completed of current.completedSkills) {
        if (!prev.completedSkills.includes(completed)) {
            newlyCompleted.push(completed);
        }
    }

    return { newSkills, updatedSkills, newlyCompleted };
}

export interface SnapshotDiff {
    newSkills: string[];
    updatedSkills: string[];
    newlyCompleted: string[];
}

// ─── Monitoring Loop ────────────────────────────────────────

export interface MonitorHandle {
    /** 監視停止 */
    stop: () => void;
    /** 最新スナップショットを取得 */
    getSnapshot: () => MonitorSnapshot;
}

/**
 * .memories/ の変更を定期ポーリングで監視する。
 *
 * @param config 監視設定
 * @param onChange 変更検知時のコールバック
 * @returns MonitorHandle（stop で終了）
 */
export function startMonitor(
    config: MonitorConfig = DEFAULT_MONITOR_CONFIG,
    onChange?: (diff: SnapshotDiff, snapshot: MonitorSnapshot) => void,
): MonitorHandle {
    let running = true;
    let prevSnapshot = takeSnapshot(config.memoriesDir);
    let currentSnapshot = prevSnapshot;

    const poll = () => {
        if (!running) return;

        try {
            currentSnapshot = takeSnapshot(config.memoriesDir);
            const diff = diffSnapshots(prevSnapshot, currentSnapshot);

            // 変化があったらコールバック
            if (diff.newSkills.length > 0 || diff.updatedSkills.length > 0 || diff.newlyCompleted.length > 0) {
                onChange?.(diff, currentSnapshot);
            }

            prevSnapshot = currentSnapshot;
        } catch (err) {
            // I/O エラーは無視して次のポーリングで再試行
        }

        if (running) {
            setTimeout(poll, config.pollIntervalMs);
        }
    };

    // 初回実行
    setTimeout(poll, config.pollIntervalMs);

    return {
        stop: () => { running = false; },
        getSnapshot: () => currentSnapshot,
    };
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Markdownの進捗ログからターン数をカウント
 * "## Turn N" 形式のヘッダーを数える
 */
function countTurns(content: string): number {
    const matches = content.match(/^## Turn \d+/gm);
    return matches ? matches.length : 0;
}

/**
 * 最後のターンの内容を抽出
 */
function extractLastTurn(content: string): string {
    const turns = content.split(/^(?=## Turn \d+)/m);
    if (turns.length === 0) return '';
    const last = turns[turns.length - 1].trim();
    // 最初の500文字まで
    return last.length > 500 ? last.slice(0, 500) + '...' : last;
}

/**
 * タスクボード用のサマリーを生成
 */
export function generateTaskBoardSummary(snapshot: MonitorSnapshot): string {
    const lines: string[] = [
        '# Task Board',
        '',
        `最終更新: ${snapshot.timestamp}`,
        '',
        '| スキル | ターン | 最終更新 | ステータス |',
        '|--------|--------|----------|-----------|',
    ];

    for (const skill of snapshot.skills) {
        const completed = snapshot.completedSkills.includes(skill.skill);
        const failed = snapshot.failedSkills.includes(skill.skill);
        const status = completed ? '✅ 完了' : failed ? '❌ 失敗' : '🔄 実行中';
        const time = new Date(skill.lastUpdate).toLocaleTimeString('ja-JP');
        lines.push(`| ${skill.skill} | ${skill.turns} | ${time} | ${status} |`);
    }

    return lines.join('\n');
}

// ─── Self-Test ──────────────────────────────────────────────

async function selfTest(): Promise<void> {
    console.log('\n═══════════════════════════════════════════');
    console.log('  🧪 Agent Monitor Self-Test');
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

    // テスト用ディレクトリ
    const testDir = path.join(process.cwd(), '.test-monitor-workspace');
    const memoriesDir = path.join(testDir, '.memories');
    const progressDir = path.join(memoriesDir, 'progress');
    const resultsDir = path.join(memoriesDir, 'results');
    fs.mkdirSync(progressDir, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });

    // Test 1: collectProgress（空）
    console.log('  [1/6] collectProgress (空ディレクトリ)...');
    const empty = collectProgress(memoriesDir);
    assert(empty.length === 0, 'スキル数: 0');

    // Test 2: collectProgress（進捗あり）
    console.log('\n  [2/6] collectProgress (進捗ファイルあり)...');
    fs.writeFileSync(path.join(progressDir, 'architect.md'), [
        '# architect 進捗',
        '',
        '## Turn 1',
        '- SPEC.md 作成開始',
        '',
        '## Turn 2',
        '- SPEC.md 完了',
    ].join('\n'));
    const progress = collectProgress(memoriesDir);
    assert(progress.length === 1, 'スキル数: 1');
    assert(progress[0].skill === 'architect', 'スキル名: architect');
    assert(progress[0].turns === 2, 'ターン数: 2');

    // Test 3: collectResults
    console.log('\n  [3/6] collectResults...');
    fs.writeFileSync(path.join(resultsDir, 'architect.md'), '# 結果\n完了');
    const results = collectResults(memoriesDir);
    assert(results.length === 1, '完了スキル数: 1');
    assert(results[0] === 'architect', '完了スキル名: architect');

    // Test 4: takeSnapshot
    console.log('\n  [4/6] takeSnapshot...');
    const snap = takeSnapshot(memoriesDir);
    assert(snap.skills.length === 1, 'スナップショット スキル数: 1');
    assert(snap.completedSkills.includes('architect'), 'architect 完了');

    // Test 5: diffSnapshots
    console.log('\n  [5/6] diffSnapshots...');
    const prevSnap: MonitorSnapshot = {
        timestamp: new Date(Date.now() - 10000).toISOString(),
        skills: [],
        completedSkills: [],
        failedSkills: [],
    };
    const diff = diffSnapshots(prevSnap, snap);
    assert(diff.newSkills.includes('architect'), '新規スキル: architect');
    assert(diff.newlyCompleted.includes('architect'), '新規完了: architect');

    // Test 6: generateTaskBoardSummary
    console.log('\n  [6/6] generateTaskBoardSummary...');
    const summary = generateTaskBoardSummary(snap);
    assert(summary.includes('architect'), 'サマリーに architect 含む');
    assert(summary.includes('✅ 完了'), 'サマリーに完了ステータス含む');
    assert(summary.includes('Task Board'), 'タイトル含む');

    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });

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
