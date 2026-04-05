export type EvaluationStatus = 'CONTINUE' | 'ABORT' | 'ESCALATE';

export interface EvaluationResult {
  status: EvaluationStatus;
  reason: string;
  confidenceScore: number; // 0.0 - 1.0
  summary?: string;
  coreIssue?: string;
  options?: string[];
}
