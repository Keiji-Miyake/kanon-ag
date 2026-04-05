/**
 * AI Judge Infrastructure Implementation.
 * Builds a powerful system prompt and uses a runner (LLM caller) to get the objective judgment.
 */
export class AiJudgeClient {
    runner;
    /**
     * @param runner A function that takes a prompt and returns the agent's output string.
     */
    constructor(runner) {
        this.runner = runner;
    }
    /**
     * Evaluates the current task progress based on provided context.
     * @param context Detailed execution history and current state.
     */
    async evaluate(context) {
        const systemPrompt = `
# AI Judge: Objective Progress & Viability Assessment
You are an independent, highly critical supervisor agent ("AI Judge"). 
Your mission is to analyze the provided execution history and determine if the autonomous development loop should continue, be aborted, or if human intervention (escalation) is required.

## ⚖️ Decision Matrix

### 1. ABORT (Terminate Execution)
- **Deadly Stagnation**: The agent has repeated the exact same error or approach for 3 or more iterations without showing any signs of learning or changing tactics.
- **Unresolvable Blocker**: A fundamental requirement is missing (e.g., API keys, non-existent files that cannot be created, permission issues) that the agent cannot fix.
- **Drift**: The agent has strayed so far from the original goal that the current state is irrelevant or irrecoverable.

### 2. CONTINUE (Proceed with Caution)
- **Incremental Progress**: Even with errors, the agent is trying NEW approaches and narrowing down the problem.
- **Learning**: The agent explicitly acknowledges why the previous attempt failed and is proposing a logically different solution.
- **Transient Failures**: Errors look like network glitches or minor syntax bugs that a retry might fix.

### 3. ESCALATE (Human Intervention Required)
- **Ambiguity**: The requirements or feedback are contradictory or unclear, and the agent is forced to make guesses that could lead to major rework.
- **High-Risk Decision**: A proposed action involves destructive changes or massive refactoring that warrants user approval.
- **Low Confidence**: You lean towards ABORT, but you're not 100% sure if a human could quickly unblock it.

## 📝 Current Context to Analyze
--- START OF CONTEXT ---
${context}
--- END OF CONTEXT ---

## 📤 Output Requirement
Analyze the context deeply. Then, output your decision in the following JSON format within a code block:

\`\`\`json:evaluation-result
{
  "status": "CONTINUE" | "ABORT" | "ESCALATE",
  "reason": "Detailed explanation citing specific iteration numbers or log entries.",
  "confidenceScore": 0.0 to 1.0,
  "summary": "Brief summary of the situation (Required for ESCALATE)",
  "coreIssue": "The central problem causing the deadlock (Required for ESCALATE)",
  "options": ["Option A", "Option B", ...] (Required for ESCALATE)
}
\`\`\`

YOUR RESPONSE MUST BE ONLY THE JSON BLOCK. BE OBJECTIVE AND STRICT.
`;
        const output = await this.runner(systemPrompt);
        return this.parseResult(output);
    }
    parseResult(output) {
        const match = output.match(/```json:evaluation-result\s+([\s\S]*?)\s+```/);
        if (!match) {
            // If the LLM failed to format correctly, try to find any JSON-like structure
            const jsonMatch = output.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                try {
                    const data = JSON.parse(jsonMatch[0]);
                    return this.mapToEvaluationResult(data);
                }
                catch (e) { }
            }
            return {
                status: 'CONTINUE',
                reason: `Failed to parse AI Judge output: ${output.substring(0, 200)}... Defaulting to CONTINUE.`,
                confidenceScore: 0.1
            };
        }
        try {
            const result = JSON.parse(match[1]);
            return this.mapToEvaluationResult(result);
        }
        catch (e) {
            return {
                status: 'CONTINUE',
                reason: 'Invalid JSON format in AI Judge response. Defaulting to CONTINUE.',
                confidenceScore: 0.1
            };
        }
    }
    mapToEvaluationResult(data) {
        return {
            status: (['CONTINUE', 'ABORT', 'ESCALATE'].includes(data.status) ? data.status : 'CONTINUE'),
            reason: data.reason || 'No reason provided by AI Judge.',
            confidenceScore: typeof data.confidenceScore === 'number' ? data.confidenceScore : 0.5,
            summary: data.summary,
            coreIssue: data.coreIssue,
            options: Array.isArray(data.options) ? data.options : undefined
        };
    }
}
