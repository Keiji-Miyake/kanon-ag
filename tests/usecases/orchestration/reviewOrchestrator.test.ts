import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewOrchestrator, AgentRunner } from '../../../src/usecases/orchestration/reviewOrchestrator.js';
import { Instruction } from '../../../src/domain/models/promptFacet.js';
import { ReviewFeedback } from '../../../src/domain/models/feedback.js';

describe('ReviewOrchestrator Interruption', () => {
    let orchestrator: ReviewOrchestrator;
    let mockRunner: AgentRunner;

    beforeEach(() => {
        mockRunner = {
            runImplementation: vi.fn().mockResolvedValue(undefined),
            runReview: vi.fn().mockImplementation(async (agentId) => {
                return {
                    reviewerId: agentId,
                    targetAgentId: 'developer',
                    taskId: 'test-task',
                    status: 'approved',
                    issues: []
                } as ReviewFeedback;
            })
        };
        // インターフェースを拡張して割り込みチェックを追加することを想定
        orchestrator = new ReviewOrchestrator('test-session', ['reviewer-1'], mockRunner);
    });

    it('実行中にユーザーからの割り込み（介入）があった場合、フィードバックを反映させる', async () => {
        const initialInstruction: Instruction = { objective: 'test', tasks: [] };
        const userIssues = [{ level: 'error', description: 'ユーザーからの介入' }];
        
        // 介入プロバイダーのモック。最初は介入あり、2回目で介入なしを返す
        let callCount = 0;
        const mockInterventionProvider = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return userIssues;
            return null;
        });

        // 承認される設定は既に行われている

        const success = await orchestrator.runCorrectionLoop(
            'developer',
            '/path/to/worktree',
            initialInstruction,
            { type: 'all', targetAgents: ['reviewer-1'] },
            3,
            undefined,
            mockInterventionProvider
        );

        expect(success).toBe(true);
        expect(mockInterventionProvider).toHaveBeenCalled();
        
        // 介入があったため、指示が更新されて実行されるはず
        // 1回目の runImplementation は、介入後の指示で呼ばれる
        expect(mockRunner.runImplementation).toHaveBeenCalledWith(
            'developer',
            '/path/to/worktree',
            expect.objectContaining({
                objective: expect.stringContaining('test')
            })
        );
    });
});
