import { Instruction } from './promptFacet.js';

export type IssueLevel = 'error' | 'warning' | 'suggestion';

export interface Issue {
    level: IssueLevel;
    description: string;
    filePaths?: string[];
    lineNumber?: number;
    suggestedFix?: string;
}

export interface ReviewFeedback {
    reviewerId: string;
    targetAgentId: string;
    taskId: string;
    status: 'approved' | 'rejected' | 'needs_work';
    issues: Issue[];
    revisedInstruction?: Instruction; // オプション: エージェントに戻すための修正済みInstruction
}
