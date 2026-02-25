export type ConditionType = 'all' | 'any';

export interface AggregateCondition {
    type: ConditionType;
    targetAgents: string[]; // 待機対象のエージェント
}

export interface TransitionEdge {
    targetState: string;
    condition: 'success' | 'failure' | 'rejected' | string;
    action?: string; // 例: 'merge', 'rollback', 'inject_feedback'
}

export interface StateNode {
    id: string;
    description: string;
    agentsToRun: string[]; // この状態でアクションを実行するエージェントの識別子
    aggregateCondition?: AggregateCondition; // 複数のエージェントが実行される場合、その結果をどう統合するか
    transitions: TransitionEdge[];
    isTerminal?: boolean; // SUCCESS/FAILEDなどの終了状態の場合はtrue
}
