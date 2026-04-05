import { describe, it, expect, vi } from 'vitest';
import { AiJudgeClient } from '../../../src/infrastructure/ai/aiJudgeClient.js';

describe('AiJudgeClient', () => {
    it('should return ABORT when the LLM suggests ABORT', async () => {
        const mockRunner = vi.fn().mockResolvedValue('```json:evaluation-result\n{\n  "status": "ABORT",\n  "reason": "Agent is stuck in a loop.",\n  "confidenceScore": 0.9\n}\n```');
        const client = new AiJudgeClient(mockRunner);
        const result = await client.evaluate('some context');

        expect(result.status).toBe('ABORT');
        expect(result.reason).toBe('Agent is stuck in a loop.');
        expect(result.confidenceScore).toBe(0.9);
    });

    it('should return CONTINUE when the LLM suggests CONTINUE', async () => {
        const mockRunner = vi.fn().mockResolvedValue('```json:evaluation-result\n{\n  "status": "CONTINUE",\n  "reason": "Making progress.",\n  "confidenceScore": 0.8\n}\n```');
        const client = new AiJudgeClient(mockRunner);
        const result = await client.evaluate('some context');

        expect(result.status).toBe('CONTINUE');
        expect(result.reason).toBe('Making progress.');
        expect(result.confidenceScore).toBe(0.8);
    });

    it('should return ESCALATE with summary, coreIssue, and options', async () => {
        const mockRunner = vi.fn().mockResolvedValue('```json:evaluation-result\n{\n  "status": "ESCALATE",\n  "reason": "Ambiguous requirement.",\n  "confidenceScore": 0.7,\n  "summary": "Need clarification on X.",\n  "coreIssue": "X is not defined.",\n  "options": ["Define X as A", "Define X as B"]\n}\n```');
        const client = new AiJudgeClient(mockRunner);
        const result = await client.evaluate('some context');

        expect(result.status).toBe('ESCALATE');
        expect(result.summary).toBe('Need clarification on X.');
        expect(result.coreIssue).toBe('X is not defined.');
        expect(result.options).toEqual(['Define X as A', 'Define X as B']);
    });

    it('should fallback to CONTINUE when LLM output is not in JSON block but contains JSON', async () => {
        const mockRunner = vi.fn().mockResolvedValue('Some rambling text before {\n  "status": "ABORT",\n  "reason": "Actually I found it.",\n  "confidenceScore": 0.5\n} and after.');
        const client = new AiJudgeClient(mockRunner);
        const result = await client.evaluate('some context');

        expect(result.status).toBe('ABORT');
        expect(result.reason).toBe('Actually I found it.');
    });

    it('should fallback to CONTINUE when LLM output is completely invalid', async () => {
        const mockRunner = vi.fn().mockResolvedValue('This is just garbage text with no JSON.');
        const client = new AiJudgeClient(mockRunner);
        const result = await client.evaluate('some context');

        expect(result.status).toBe('CONTINUE');
        expect(result.reason).toContain('Failed to parse AI Judge output');
        expect(result.confidenceScore).toBe(0.1);
    });

    it('should handle invalid JSON inside code block by falling back to CONTINUE', async () => {
        const mockRunner = vi.fn().mockResolvedValue('```json:evaluation-result\n { "invalid": "json", missing_quote: value }\n```');
        const client = new AiJudgeClient(mockRunner);
        const result = await client.evaluate('some context');

        expect(result.status).toBe('CONTINUE');
        expect(result.reason).toContain('Invalid JSON format');
    });
});
