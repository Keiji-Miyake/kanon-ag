import { describe, it, expect } from 'vitest';
import { MergeGateway } from '../../../src/domain/services/mergeGateway.js';
import { AggregateCondition } from '../../../src/domain/models/fsmNode.js';
import { ReviewFeedback } from '../../../src/domain/models/feedback.js';

describe('MergeGateway', () => {
    const gateway = new MergeGateway();

    // ----- テスト用フィードバックファクトリ -----
    function makeFeedback(reviewerId: string, status: ReviewFeedback['status']): ReviewFeedback {
        return { reviewerId, targetAgentId: 'developer', taskId: 'task-1', status, issues: [] };
    }

    // =====================
    // ALL 条件
    // =====================
    describe("条件タイプ 'all'", () => {
        const condition: AggregateCondition = {
            type: 'all',
            targetAgents: ['reviewer-a', 'reviewer-b'],
        };

        it('全員が承認 → isResolved: true, isApproved: true', () => {
            const feedbacks = [
                makeFeedback('reviewer-a', 'approved'),
                makeFeedback('reviewer-b', 'approved'),
            ];
            const result = gateway.evaluate(condition, feedbacks);
            expect(result.isResolved).toBe(true);
            expect(result.isApproved).toBe(true);
            expect(result.pendingAgents).toHaveLength(0);
        });

        it('一人が承認済み、一人が未応答 → isResolved: false（待機）', () => {
            const feedbacks = [makeFeedback('reviewer-a', 'approved')];
            const result = gateway.evaluate(condition, feedbacks);
            expect(result.isResolved).toBe(false);
            expect(result.isApproved).toBe(false);
            expect(result.pendingAgents).toContain('reviewer-b');
        });

        it('全員が応答したが一人が棄却 → isResolved: true, isApproved: false', () => {
            const feedbacks = [
                makeFeedback('reviewer-a', 'approved'),
                makeFeedback('reviewer-b', 'rejected'),
            ];
            const result = gateway.evaluate(condition, feedbacks);
            expect(result.isResolved).toBe(true);
            expect(result.isApproved).toBe(false);
        });

        it('誰も応答していない → isResolved: false', () => {
            const result = gateway.evaluate(condition, []);
            expect(result.isResolved).toBe(false);
            expect(result.pendingAgents).toEqual(['reviewer-a', 'reviewer-b']);
        });
    });

    // =====================
    // ANY 条件
    // =====================
    describe("条件タイプ 'any'", () => {
        const condition: AggregateCondition = {
            type: 'any',
            targetAgents: ['reviewer-a', 'reviewer-b'],
        };

        it('一人が承認 → isResolved: true, isApproved: true（他は待機中でも可）', () => {
            const feedbacks = [makeFeedback('reviewer-a', 'approved')];
            const result = gateway.evaluate(condition, feedbacks);
            expect(result.isResolved).toBe(true);
            expect(result.isApproved).toBe(true);
        });

        it('全員が応答したが全員が棄却 → isResolved: true, isApproved: false', () => {
            const feedbacks = [
                makeFeedback('reviewer-a', 'rejected'),
                makeFeedback('reviewer-b', 'rejected'),
            ];
            const result = gateway.evaluate(condition, feedbacks);
            expect(result.isResolved).toBe(true);
            expect(result.isApproved).toBe(false);
        });

        it('誰も応答していない → isResolved: false（待機）', () => {
            const result = gateway.evaluate(condition, []);
            expect(result.isResolved).toBe(false);
        });

        it('一部が棄却、残りが未応答 → isResolved: false（他の承認を待機）', () => {
            const feedbacks = [makeFeedback('reviewer-a', 'rejected')];
            const result = gateway.evaluate(condition, feedbacks);
            expect(result.isResolved).toBe(false);
            expect(result.pendingAgents).toContain('reviewer-b');
        });
    });

    // =====================
    // 不明な条件タイプ
    // =====================
    describe('未定義の条件タイプ', () => {
        it('不明な type → エラーをスロー', () => {
            const badCondition = { type: 'unknown', targetAgents: [] } as any;
            expect(() => gateway.evaluate(badCondition, [])).toThrow();
        });
    });
});
