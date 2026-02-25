import { StateNode, TransitionEdge } from '../../domain/models/fsmNode.js';

export class TransitionEngine {
    /**
     * 現在の状態ノードと実行条件 (例: 'success', 'failure', 'rejected') に基づいて、次に遷移すべき状態のIDを決定します。
     * 該当する条件に対する有効な遷移先が見つからなかった場合はエラーをスローします。
     */
    public determineNextState(currentNode: StateNode, executionCondition: string): string {
        if (currentNode.isTerminal) {
            throw new Error(`Cannot transition from a terminal state node: ${currentNode.id}`);
        }

        const validEdge = currentNode.transitions.find((edge: TransitionEdge) => edge.condition === executionCondition);

        if (!validEdge) {
            throw new Error(`No transition defined for condition '${executionCondition}' in state '${currentNode.id}'`);
        }

        return validEdge.targetState;
    }

    /**
     * 選択された遷移に関連付けられたアクション（存在する場合）を取得するヘルパーメソッドです。
     */
    public getTransitionAction(currentNode: StateNode, executionCondition: string): string | undefined {
        const validEdge = currentNode.transitions.find((edge: TransitionEdge) => edge.condition === executionCondition);
        return validEdge?.action;
    }
}
