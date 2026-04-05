export class FeedbackInjector {
    /**
     * 元のInstructionにフィードバックによるIssueを注入し、リトライや修正ループのための新しいInstructionを作成します。
     */
    injectIssues(currentInstruction, issues) {
        if (!issues || issues.length === 0) {
            return currentInstruction;
        }
        const amendedTasks = [...currentInstruction.tasks];
        let hasUserIntervention = false;
        const issueDescriptions = issues.map((issue, index) => {
            if (issue.source === 'user') {
                hasUserIntervention = true;
                return `[USER DIRECT INSTRUCTION]: ${issue.description}`;
            }
            let desc = `Issue ${index + 1} [${issue.level.toUpperCase()}]: ${issue.description}`;
            if (issue.filePaths && issue.filePaths.length > 0) {
                desc += ` (Files: ${issue.filePaths.join(', ')})`;
            }
            if (issue.lineNumber) {
                desc += ` (Line: ${issue.lineNumber})`;
            }
            if (issue.suggestedFix) {
                desc += `\n   Suggestion: ${issue.suggestedFix}`;
            }
            return desc;
        });
        const header = hasUserIntervention
            ? `CRITICAL: You must address the following USER INTERVENTIONS and review feedback immediately:\n`
            : `ADDRESS REVIEW FEEDBACK: You must fix the following issues identified during the review phase:\n`;
        amendedTasks.push(header + issueDescriptions.join('\n'));
        return {
            objective: hasUserIntervention
                ? `[USER INTERVENTION] ${currentInstruction.objective}`
                : `[REVISION REQUIRED] ${currentInstruction.objective}`,
            tasks: amendedTasks
        };
    }
    /**
     * 元のInstructionにユーザーからの直接の介入（割り込みメッセージ）を注入します。
     */
    injectUserIntervention(currentInstruction, message) {
        if (!message || message.trim().length === 0) {
            return currentInstruction;
        }
        const amendedTasks = [...currentInstruction.tasks];
        amendedTasks.push(`USER INTERVENTION: The user has provided the following direct instruction/feedback that you must incorporate immediately:\n` +
            message);
        return {
            objective: `[USER INTERVENTION] ${currentInstruction.objective}`,
            tasks: amendedTasks
        };
    }
}
