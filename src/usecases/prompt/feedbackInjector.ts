import { Instruction } from '../../domain/models/promptFacet.js';
import { Issue } from '../../domain/models/feedback.js';

export class FeedbackInjector {
    /**
     * 元のInstructionにフィードバックによるIssueを注入し、リトライや修正ループのための新しいInstructionを作成します。
     */
    public injectIssues(currentInstruction: Instruction, issues: Issue[]): Instruction {
        if (!issues || issues.length === 0) {
            return currentInstruction;
        }

        const amendedTasks = [...currentInstruction.tasks];

        const issueDescriptions = issues.map((issue, index) => {
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

        amendedTasks.push(
            `ADDRESS REVIEW FEEDBACK: You must fix the following issues identified during the review phase:\n` +
            issueDescriptions.join('\n')
        );

        return {
            objective: `[REVISION REQUIRED] ${currentInstruction.objective}`,
            tasks: amendedTasks
        };
    }
}
