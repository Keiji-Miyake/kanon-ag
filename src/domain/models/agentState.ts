export type AgentId = string;

export interface AgentContext {
    currentTaskId: string;
    workingDirectory: string;
    blackboardRevisions: Record<string, number>; // どのKnowledgeリビジョンまで確認したかを追跡
}

export interface AgentState {
    agentId: AgentId;
    role: string;
    status: 'idle' | 'running' | 'completed' | 'failed' | 'waiting_for_dependencies';
    context: AgentContext;
    currentInstruction?: string;     // 最終的に実行されているInstruction内容
    lastError?: string;
}
