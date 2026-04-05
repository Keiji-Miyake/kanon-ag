export class AIWatchdog {
    /**
     * コンテキスト（過去の出力履歴など）を分析し、進捗が停滞しているか判定するプロンプトを構築する。
     */
    buildWatchdogPrompt(history) {
        const historyText = history.map((h, i) => `## Iteration ${i + 1} (${h.skill})\n${h.output}`).join('\n\n');
        return `
# AI Watchdog: Progress Assessment
You are an independent supervisor monitoring a development loop. Your task is to analyze the history of agent outputs and determine if the process is making meaningful progress or if it is stuck in a loop (e.g., repeating the same errors, failing to address reviewer feedback).

## Output History
${historyText}

## Assessment Task
Review the history carefully.
1. Is the latest output significantly different and improved compared to previous ones?
2. Are the same errors or issues persisting across multiple iterations?
3. Is the agent actually addressing the feedback provided in earlier steps?

## Output Requirement
You MUST output your assessment in the following format:

\`\`\`json:watchdog-result
{
  "isStalled": true or false,
  "reason": "Detailed explanation of your assessment",
  "suggestion": "Optional suggestion for the human or the next agent to break the loop"
}
\`\`\`
`;
    }
}
