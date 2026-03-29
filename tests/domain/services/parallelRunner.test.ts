import { describe, it, expect, vi } from 'vitest';
import { ParallelRunner } from '../../../src/domain/services/parallelRunner.js';

describe('ParallelRunner', () => {
    it('複数のエージェントを並列実行し、出力を収集できること', async () => {
        // Mock runner function
        const mockRunner = vi.fn().mockImplementation(async (skill: string) => {
            return `Output from ${skill}`;
        });

        const runner = new ParallelRunner(mockRunner);
        const results = await runner.run(['s1', 's2', 's3']);

        expect(results).toHaveLength(3);
        expect(results).toContain('Output from s1');
        expect(results).toContain('Output from s2');
        expect(results).toContain('Output from s3');
        expect(mockRunner).toHaveBeenCalledTimes(3);
    });

    it('空のリストの場合、空の配列を返すこと', async () => {
        const runner = new ParallelRunner(async () => '');
        const results = await runner.run([]);
        expect(results).toHaveLength(0);
    });
});
