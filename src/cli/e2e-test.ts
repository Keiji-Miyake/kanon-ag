#!/usr/bin/env node
/**
 * E2E Test — マルチエージェント並列実行パイプライン統合検証
 *
 * 全モジュールを連携させた統合テスト:
 *   1. CLI解決 (cli-resolver)
 *   2. メモリバンク初期化 (memory-manager)
 *   3. モックエージェント spawn (agent-spawner)
 *   4. 進捗監視 (agent-monitor)
 *   5. ダッシュボード描画 (dashboard)
 *
 * Usage:
 *   npx ts-node e2e-test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Import Modules ─────────────────────────────────────────

import {
    initSession, readSession, updateSession,
    updateTaskBoard, readTaskBoard,
    appendProgress, readProgress,
    writeResult, readResult,
    updateMetrics, readMetrics,
    cleanMemories,
} from './memory-manager';

import {
    loadConfig, resolveCli, buildCommand, detectAvailableClis,
} from './cli-resolver';

import {
    spawnAgent, getAgentStatus, killAgent,
    countRunningAgents, executeBatch, clearRegistry,
    DEFAULT_SPAWN_CONFIG,
} from './agent-spawner';
import type { BatchTask } from './agent-spawner';

import {
    collectProgress, collectResults, takeSnapshot,
    diffSnapshots, generateTaskBoardSummary,
} from './agent-monitor';

import { renderDashboard } from './dashboard';

// ─── Test Helpers ───────────────────────────────────────────

const TEST_WORKSPACE = path.join(process.cwd(), '.e2e-test-workspace');
const MEMORIES_DIR = path.join(TEST_WORKSPACE, '.memories');

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, message: string): void {
    total++;
    if (condition) {
        console.log(`    ✅ ${message}`);
        passed++;
    } else {
        console.log(`    ❌ ${message}`);
        failed++;
    }
}

function section(title: string): void {
    console.log(`\n  ── ${title} ──`);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Mock Agent Script ──────────────────────────────────────

/**
 * モックエージェントスクリプトを生成。
 * .memories/progress/{skill}.md に進捗を書き込み、
 * .memories/results/{skill}.md に結果を書き込んで終了する。
 */
function createMockAgentScript(skill: string, turns: number, delayMs: number): string {
    const progressDir = path.join(MEMORIES_DIR, 'progress');
    const resultsDir = path.join(MEMORIES_DIR, 'results');

    // シェルスクリプトとして生成
    const lines: string[] = [
        `#!/bin/sh`,
        `mkdir -p "${progressDir}" "${resultsDir}"`,
    ];

    for (let i = 1; i <= turns; i++) {
        lines.push(`sleep ${delayMs / 1000}`);
        lines.push(`echo "## Turn ${i}" >> "${progressDir}/${skill}.md"`);
        lines.push(`echo "- Turn ${i} 完了" >> "${progressDir}/${skill}.md"`);
        lines.push(`echo "" >> "${progressDir}/${skill}.md"`);
    }

    // 結果ファイル
    lines.push(`echo "# ${skill} 結果" > "${resultsDir}/${skill}.md"`);
    lines.push(`echo "ステータス: 完了" >> "${resultsDir}/${skill}.md"`);
    lines.push(`echo "ターン数: ${turns}" >> "${resultsDir}/${skill}.md"`);

    return lines.join('\n');
}

// ─── E2E Test ───────────────────────────────────────────────

async function runE2E(): Promise<void> {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  🧪 E2E Test — マルチエージェント並列実行パイプライン  ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    // Cleanup
    if (fs.existsSync(TEST_WORKSPACE)) {
        fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_WORKSPACE, { recursive: true });

    const sessionId = `e2e-${Date.now()}`;

    // ═══════════════════════════════════════════════
    // Phase A: CLI Resolver 統合
    // ═══════════════════════════════════════════════
    section('Phase A: CLI Resolver 統合');

    const config = loadConfig();
    assert(config !== null, 'cli-config.yaml 読み込み成功');
    assert(config.default_cli === 'gemini', 'デフォルトCLI: gemini');

    const { cliName, definition } = resolveCli('conductor', config);
    assert(cliName === 'gemini', 'conductor → gemini 解決');

    const cmd = buildCommand(definition, 'テストプロンプト', { autoApprove: true });
    assert(cmd.includes('gemini'), 'コマンドにgemini含む');
    assert(cmd.includes('--approval-mode=yolo'), 'auto_approve フラグ含む');
    assert(cmd.includes('テストプロンプト'), 'プロンプト含む');

    // CLI検出
    const clis = detectAvailableClis(config);
    assert(clis.length > 0, `CLI定義数: ${clis.length}`);
    const availableCount = clis.filter(c => c.available).length;
    console.log(`    📌 利用可能CLI: ${availableCount}/${clis.length} (${clis.filter(c => c.available).map(c => c.name).join(', ') || 'なし'})`);

    // ═══════════════════════════════════════════════
    // Phase B: Memory Manager 統合
    // ═══════════════════════════════════════════════
    section('Phase B: Memory Manager 統合');

    const session = initSession(sessionId, TEST_WORKSPACE);
    assert(session.id === sessionId, `セッション初期化: ${sessionId}`);
    assert(session.status === 'initializing', 'ステータス: initializing');
    assert(fs.existsSync(path.join(MEMORIES_DIR, 'session.md')), 'session.md 生成');
    assert(fs.existsSync(path.join(MEMORIES_DIR, 'progress')), 'progress/ 生成');
    assert(fs.existsSync(path.join(MEMORIES_DIR, 'results')), 'results/ 生成');

    // セッション更新
    updateSession('running', 'Phase B: メモリ', TEST_WORKSPACE);
    const readBack = readSession(TEST_WORKSPACE);
    if (!readBack) throw new Error('Session read failed');
    assert(readBack.status === 'running', 'セッション更新: running');

    // タスクボード
    updateTaskBoard([
        { skill: 'conductor', status: 'running', cli: 'gemini', startedAt: new Date().toISOString(), turns: 0, completedAt: null, pid: 123, retryCount: 0 },
        { skill: 'architect', status: 'pending', cli: 'gemini', startedAt: null, turns: 0, completedAt: null, pid: null, retryCount: 0 },
        { skill: 'developer', status: 'pending', cli: 'gemini', startedAt: null, turns: 0, completedAt: null, pid: null, retryCount: 0 },
    ], TEST_WORKSPACE);
    const board = readTaskBoard(TEST_WORKSPACE);
    assert(board.length === 3, `タスクボード: ${board.length} エントリ`);

    // 進捗ログ
    appendProgress('conductor', 1, '- プロジェクト計画を策定', TEST_WORKSPACE);
    appendProgress('conductor', 2, '- タスクリスト作成完了', TEST_WORKSPACE);
    const progress = readProgress('conductor', TEST_WORKSPACE);
    assert(progress !== null && progress.includes('Turn 1'), '進捗ログ: Turn 1');
    assert(progress !== null && progress.includes('Turn 2'), '進捗ログ: Turn 2');

    // 結果
    writeResult('conductor', { skill: 'conductor', status: 'success', artifacts: ['AGENTS.md'], summary: 'Completed', elapsedMs: 1000, turns: 2 }, TEST_WORKSPACE);
    const result = readResult('conductor', TEST_WORKSPACE);
    assert(result !== null && result.includes('success'), '結果: success含む');

    // メトリクス
    updateMetrics('conductor', { turns: 2, elapsedMs: 5000, retries: 0, status: 'success' }, TEST_WORKSPACE);
    const metrics = readMetrics(TEST_WORKSPACE);
    assert(!!metrics && metrics.skills?.conductor?.turns === 2, 'メトリクス: turns=2');

    // ═══════════════════════════════════════════════
    // Phase C: Agent Spawner 統合
    // ═══════════════════════════════════════════════
    section('Phase C: Agent Spawner 統合');

    clearRegistry();

    // モックエージェント: 2ターン、100ms遅延
    const mockScript1 = createMockAgentScript('mock-arch', 2, 100);
    const mockScript2 = createMockAgentScript('mock-dev', 3, 100);

    // バッチ実行（mock-dev は mock-arch に依存）
    const tasks: BatchTask[] = [
        { skill: 'mock-arch', command: mockScript1, cliName: 'mock' },
        { skill: 'mock-dev', command: mockScript2, cliName: 'mock', dependsOn: ['mock-arch'] },
    ];

    const batchResults = await executeBatch(
        tasks,
        sessionId,
        { ...DEFAULT_SPAWN_CONFIG, pollIntervalMs: 500, timeoutMs: 30000, retryDelaysMs: [1000] },
        TEST_WORKSPACE,
    );

    assert(batchResults.length === 2, `バッチ結果数: ${batchResults.length}`);

    const archResult = batchResults.find(r => r.skill === 'mock-arch');
    const devResult = batchResults.find(r => r.skill === 'mock-dev');
    assert(archResult?.success === true, 'mock-arch 成功');
    assert(devResult?.success === true, 'mock-dev 成功');

    // 依存関係: mock-dev は mock-arch の後に実行されたか
    assert(archResult !== undefined && devResult !== undefined, '両タスク結果あり');

    // ═══════════════════════════════════════════════
    // Phase D: Agent Monitor 統合
    // ═══════════════════════════════════════════════
    section('Phase D: Agent Monitor 統合');

    // モックエージェントが .memories/ に書いたファイルを監視
    const progressList = collectProgress(MEMORIES_DIR);
    assert(progressList.length >= 2, `進捗スキル数: ${progressList.length} (conductor + mock含む)`);

    const mockArchProgress = progressList.find(p => p.skill === 'mock-arch');
    assert(mockArchProgress !== undefined, 'mock-arch 進捗検出');
    assert(mockArchProgress!.turns === 2, `mock-arch ターン数: ${mockArchProgress?.turns}`);

    const mockDevProgress = progressList.find(p => p.skill === 'mock-dev');
    assert(mockDevProgress !== undefined, 'mock-dev 進捗検出');
    assert(mockDevProgress!.turns === 3, `mock-dev ターン数: ${mockDevProgress?.turns}`);

    const completedSkills = collectResults(MEMORIES_DIR);
    assert(completedSkills.includes('mock-arch'), 'mock-arch 結果検出');
    assert(completedSkills.includes('mock-dev'), 'mock-dev 結果検出');
    assert(completedSkills.includes('conductor'), 'conductor 結果検出');

    // スナップショット
    const snapshot = takeSnapshot(MEMORIES_DIR);
    assert(snapshot.skills.length >= 3, `スナップショット スキル数: ${snapshot.skills.length}`);
    assert(snapshot.completedSkills.length >= 3, `完了スキル数: ${snapshot.completedSkills.length}`);

    // タスクボードサマリー
    const summary = generateTaskBoardSummary(snapshot);
    assert(summary.includes('mock-arch'), 'サマリーに mock-arch');
    assert(summary.includes('✅ 完了'), 'サマリーに完了ステータス');

    // 差分検出
    const emptySnap = { timestamp: '', skills: [], completedSkills: [], failedSkills: [] };
    const diff = diffSnapshots(emptySnap, snapshot);
    assert(diff.newSkills.length >= 3, `新規スキル差分: ${diff.newSkills.length}`);
    assert(diff.newlyCompleted.length >= 3, `新規完了差分: ${diff.newlyCompleted.length}`);

    // ═══════════════════════════════════════════════
    // Phase E: Dashboard 統合
    // ═══════════════════════════════════════════════
    section('Phase E: Dashboard 統合');

    const dashboardOutput = renderDashboard(
        { id: sessionId, status: 'RUNNING', phase: 'E2E Test' },
        [
            { skill: 'conductor', cli: 'gemini', status: 'Done', statusIcon: '✅', turns: 2, elapsed: '5s' },
            { skill: 'mock-arch', cli: 'mock', status: 'Done', statusIcon: '✅', turns: 2, elapsed: '1s' },
            { skill: 'mock-dev', cli: 'mock', status: 'Done', statusIcon: '✅', turns: 3, elapsed: '1s' },
        ],
        70,
    );
    assert(dashboardOutput.includes('Agent Skills Orchestrator'), 'ダッシュボード タイトル');
    assert(dashboardOutput.includes(sessionId), 'ダッシュボード セッションID');
    assert(dashboardOutput.includes('conductor'), 'ダッシュボード conductor行');
    assert(dashboardOutput.includes('mock-arch'), 'ダッシュボード mock-arch行');

    console.log('\n  📺 ダッシュボード出力:\n');
    console.log(dashboardOutput);

    // ═══════════════════════════════════════════════
    // Phase F: クリーンアップ検証
    // ═══════════════════════════════════════════════
    section('Phase F: クリーンアップ検証');

    cleanMemories(TEST_WORKSPACE);
    assert(!fs.existsSync(MEMORIES_DIR), '.memories/ 削除完了');

    // テストワークスペース全体削除
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    assert(!fs.existsSync(TEST_WORKSPACE), 'テストワークスペース削除完了');

    clearRegistry();

    // ═══════════════════════════════════════════════
    // 最終結果
    // ═══════════════════════════════════════════════
    console.log('\n╔══════════════════════════════════════════════════════╗');
    if (failed === 0) {
        console.log(`║  🎉 E2E テスト: ${passed}/${total} 全合格                          ║`);
    } else {
        console.log(`║  ⚠️  E2E テスト: ${passed}/${total} (失敗: ${failed})                        ║`);
    }
    console.log('╚══════════════════════════════════════════════════════╝\n');

    process.exit(failed === 0 ? 0 : 1);
}

// ─── Main ───────────────────────────────────────────────────

runE2E().catch((err) => {
    console.error('❌ E2E テスト実行エラー:', err);
    // Cleanup on failure
    if (fs.existsSync(TEST_WORKSPACE)) {
        fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    process.exit(1);
});
