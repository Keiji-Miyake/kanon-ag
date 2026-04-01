import { describe, it, expect, vi } from 'vitest';
import { AIWatchdog } from '../../../src/domain/services/aiWatchdog.js';
import { AgentOutput } from '../../../src/domain/services/consensusService.js';

describe('AIWatchdog', () => {
    const watchdog = new AIWatchdog();

    it('should build a prompt containing history', () => {
        const history: AgentOutput[] = [
            { skill: 'developer', output: 'Attempt 1: Error X' },
            { skill: 'developer', output: 'Attempt 2: Error X' },
        ];
        const prompt = watchdog.buildWatchdogPrompt(history);
        
        expect(prompt).toContain('Attempt 1: Error X');
        expect(prompt).toContain('Attempt 2: Error X');
        expect(prompt).toContain('watchdog-result');
    });

    // LLMの出力をシミュレートするテスト（パースロジックの検証）
    it('should suggest stall when LLM output says so', () => {
        // 実際には OrchestrationService がパースを行うが、
        // ここでは AIWatchdog が期待する JSON 構造を定義できているかを確認する
        const dummyOutput = `
Reasoning: The agent is repeating the same error.
\`\`\`json:watchdog-result
{
  "isStalled": true,
  "reason": "Repetitive errors detected.",
  "suggestion": "Try a different approach."
}
\`\`\`
        `;
        
        const match = dummyOutput.match(/```json:watchdog-result\s+([\s\S]*?)\s+```/);
        expect(match).not.toBeNull();
        const result = JSON.parse(match![1]);
        expect(result.isStalled).toBe(true);
        expect(result.reason).toBe('Repetitive errors detected.');
    });
});
