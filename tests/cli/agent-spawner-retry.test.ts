import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeBatch, clearRegistry, SpawnConfig } from '../../src/cli/agent-spawner.js';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

// child_process の spawn をモック
vi.mock('child_process', () => {
    return {
        spawn: vi.fn()
    };
});

describe('AgentSpawner Exponential Backoff Retry (Real Timers)', () => {
    beforeEach(() => {
        clearRegistry();
        vi.clearAllMocks();
    });

    it('タスクが失敗した場合、Exponential Backoff に従ってリトライされること', async () => {
        const sessionId = 'test-retry-session';
        const config: SpawnConfig = {
            maxParallel: 1,
            pollIntervalMs: 10,
            retryConfig: { maxRetries: 2, initialDelayMs: 20, backoffFactor: 2.0 },
            timeoutMs: 0
        };

        const tasks = [{ skill: 'retry-task', command: 'fail-command', cliName: 'test-cli' }];

        // spawn が呼ばれるたびに即エラー終了するプロセスをエミュレート
        let spawnCount = 0;
        let pids: number[] = [];
        
        vi.mocked(child_process.spawn).mockImplementation((_cmd, _args, _opts) => {
            spawnCount++;
            const cp = new EventEmitter() as child_process.ChildProcess;
            const pid = 1000 + spawnCount;
            Object.defineProperty(cp, 'pid', { value: pid, writable: true });
            pids.push(pid);
            cp.stdout = new EventEmitter() as any;
            cp.stderr = new EventEmitter() as any;
            cp.kill = vi.fn();

            // 実時間で10ms後に失敗をエミュレート
            setTimeout(() => {
                cp.emit('exit', 1);
                cp.emit('close', 1);
            }, 5);

            return cp;
        });

        const start = Date.now();
        const results = await executeBatch(tasks, sessionId, config, '/tmp');
        const end = Date.now();
        const duration = end - start;

        // すべて失敗したので success は false
        expect(results.length).toBe(1);
        expect(results[0].success).toBe(false);
        // spawn が呼ばれた回数は 初回(1) + 1回目リトライ(1) + 2回目リトライ(1) = 合計3回
        expect(spawnCount).toBe(3);

        // リトライごとの待機時間:
        // 1回目リトライ前: 20ms
        // 2回目リトライ前: 20 * 2.0 = 40ms
        // プロセス実行時間: 5ms * 3 = 15ms
        // 合計所要時間は 75ms 前後となるはず。ポーリングなどの誤差を含めて最低60msはかかっていることを確認
        expect(duration).toBeGreaterThanOrEqual(60);
    });
});
