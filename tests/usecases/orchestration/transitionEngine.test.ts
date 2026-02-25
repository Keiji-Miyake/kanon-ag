import { describe, it, expect } from 'vitest';
import { TransitionEngine } from '../../../src/usecases/orchestration/transitionEngine.js';
import { StateNode } from '../../../src/domain/models/fsmNode.js';

describe('TransitionEngine', () => {
    const engine = new TransitionEngine();

    // テスト用の StateNode（非終端ノード）
    const reviewNode: StateNode = {
        id: 'review',
        description: 'コードレビューを実行する状態',
        agentsToRun: ['reviewer'],
        transitions: [
            { targetState: 'deploy', condition: 'success', action: 'merge' },
            { targetState: 'implement', condition: 'failure', action: 'inject_feedback' },
            { targetState: 'failed', condition: 'rejected', action: 'rollback' },
        ],
    };

    // 終端ノード
    const terminalNode: StateNode = {
        id: 'terminal_success',
        description: '正常完了状態',
        agentsToRun: [],
        transitions: [],
        isTerminal: true,
    };

    // =====================
    // determineNextState
    // =====================
    describe('determineNextState()', () => {
        it("条件 'success' → 'deploy' に遷移する", () => {
            const nextState = engine.determineNextState(reviewNode, 'success');
            expect(nextState).toBe('deploy');
        });

        it("条件 'failure' → 'implement' に遷移する", () => {
            const nextState = engine.determineNextState(reviewNode, 'failure');
            expect(nextState).toBe('implement');
        });

        it("条件 'rejected' → 'failed' に遷移する", () => {
            const nextState = engine.determineNextState(reviewNode, 'rejected');
            expect(nextState).toBe('failed');
        });

        it('存在しない条件 → エラーをスロー', () => {
            expect(() => engine.determineNextState(reviewNode, 'unknown')).toThrow(
                "No transition defined for condition 'unknown' in state 'review'"
            );
        });

        it('終端ノードから遷移しようとする → エラーをスロー', () => {
            expect(() => engine.determineNextState(terminalNode, 'success')).toThrow(
                'Cannot transition from a terminal state node: terminal_success'
            );
        });
    });

    // =====================
    // getTransitionAction
    // =====================
    describe('getTransitionAction()', () => {
        it("条件 'success' のアクション → 'merge' を返す", () => {
            const action = engine.getTransitionAction(reviewNode, 'success');
            expect(action).toBe('merge');
        });

        it("条件 'failure' のアクション → 'inject_feedback' を返す", () => {
            const action = engine.getTransitionAction(reviewNode, 'failure');
            expect(action).toBe('inject_feedback');
        });

        it('存在しない条件 → undefined を返す', () => {
            const action = engine.getTransitionAction(reviewNode, 'nonexistent');
            expect(action).toBeUndefined();
        });

        it('アクションが設定されていないエッジ → undefined を返す', () => {
            const nodeWithoutAction: StateNode = {
                id: 'simple',
                description: 'アクション未設定のノード',
                agentsToRun: [],
                transitions: [{ targetState: 'next', condition: 'success' }],
            };
            const action = engine.getTransitionAction(nodeWithoutAction, 'success');
            expect(action).toBeUndefined();
        });
    });
});
