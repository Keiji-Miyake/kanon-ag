import { EvaluationResult } from '../models/evaluation.js';

export interface IAiJudgeClient {
  evaluate(context: string): Promise<EvaluationResult>;
}
