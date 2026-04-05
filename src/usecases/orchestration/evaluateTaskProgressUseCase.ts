import { IAiJudgeClient } from '../../domain/services/aiJudgeClient.js';
import { EvaluationResult } from '../../domain/models/evaluation.js';

/**
 * Use Case to evaluate the progress of a task using AI Judge.
 */
export class EvaluateTaskProgressUseCase {
    constructor(private aiJudgeClient: IAiJudgeClient) {}

    /**
     * Executes the evaluation logic.
     * @param context Context information (history, error logs, etc.)
     */
    public async execute(context: string): Promise<EvaluationResult> {
        return await this.aiJudgeClient.evaluate(context);
    }
}
