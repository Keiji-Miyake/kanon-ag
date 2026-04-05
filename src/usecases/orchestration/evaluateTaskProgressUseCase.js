/**
 * Use Case to evaluate the progress of a task using AI Judge.
 */
export class EvaluateTaskProgressUseCase {
    aiJudgeClient;
    constructor(aiJudgeClient) {
        this.aiJudgeClient = aiJudgeClient;
    }
    /**
     * Executes the evaluation logic.
     * @param context Context information (history, error logs, etc.)
     */
    async execute(context) {
        return await this.aiJudgeClient.evaluate(context);
    }
}
