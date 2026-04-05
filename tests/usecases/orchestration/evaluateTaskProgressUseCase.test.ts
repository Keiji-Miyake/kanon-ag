import { describe, it, expect, vi } from 'vitest';
import { EvaluateTaskProgressUseCase } from '../../../src/usecases/orchestration/evaluateTaskProgressUseCase.js';
import { IAiJudgeClient } from '../../../src/domain/services/aiJudgeClient.js';

describe('EvaluateTaskProgressUseCase', () => {
    it('should call aiJudgeClient.evaluate and return the result', async () => {
        const mockResult = {
            status: 'CONTINUE' as const,
            reason: 'All good',
            confidenceScore: 1.0
        };
        const mockAiJudgeClient: IAiJudgeClient = {
            evaluate: vi.fn().mockResolvedValue(mockResult)
        };

        const useCase = new EvaluateTaskProgressUseCase(mockAiJudgeClient);
        const result = await useCase.execute('test context');

        expect(mockAiJudgeClient.evaluate).toHaveBeenCalledWith('test context');
        expect(result).toEqual(mockResult);
    });
});
