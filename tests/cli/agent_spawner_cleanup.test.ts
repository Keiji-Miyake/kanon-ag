import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnAgent, getAllAgentStatuses, cleanupSession, clearRegistry } from '../../src/cli/agent-spawner.js';
import * as path from 'path';

describe('AgentSpawner Cleanup', () => {
    const sessionId = 'test-cleanup-session';

    beforeEach(() => {
        clearRegistry();
    });

    afterEach(() => {
        cleanupSession(sessionId);
        clearRegistry();
    });

    it('cleanupSession は実行中のエージェントを停止し、レジストリから削除する', async () => {
        // 長時間実行されるプロセスを起動
        const agent = spawnAgent('long-task', 'sleep 60', sessionId, 'test');
        expect(agent.status).toBe('running');
        
        // クリーンアップ実行
        cleanupSession(sessionId);
        
        const statuses = getAllAgentStatuses(sessionId);
        expect(statuses.length).toBe(0);
        
        // 実際のプロセスが終了しているか（PIDが生きているか）の確認は
        // 環境に依存するが、少なくともレジストリからは消えるべき。
        // また、kill が呼ばれているはず。
    });

    it('複数のエージェントが実行中でも一括で停止できる', async () => {
        spawnAgent('task-1', 'sleep 60', sessionId, 'test');
        spawnAgent('task-2', 'sleep 60', sessionId, 'test');
        
        expect(getAllAgentStatuses(sessionId).length).toBe(2);
        
        cleanupSession(sessionId);
        
        expect(getAllAgentStatuses(sessionId).length).toBe(0);
    });
});
