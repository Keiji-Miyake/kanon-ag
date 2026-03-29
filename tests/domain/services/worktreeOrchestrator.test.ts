import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeOrchestrator } from '../../../src/domain/services/worktreeOrchestrator.js';

describe('WorktreeOrchestrator', () => {
    const mockSandbox: any = {
        createEnvironment: vi.fn(),
        mergeEnvironment: vi.fn(),
        removeEnvironment: vi.fn(),
        sanitizeBranchName: vi.fn((n: string) => n.toLowerCase().replace(/\s+/g, '-'))
    };

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('Score 名に基づいてサンドボックスを作成できること', async () => {
        mockSandbox.createEnvironment.mockResolvedValue('/path/to/worktree/test-score');
        
        const orchestrator = new WorktreeOrchestrator(mockSandbox);
        const path = await orchestrator.setup('Test Score');

        expect(path).toBe('/path/to/worktree/test-score');
        expect(mockSandbox.createEnvironment).toHaveBeenCalledWith(expect.objectContaining({
            environmentName: expect.stringContaining('test-score')
        }));
    });

    it('成功時にマージとクリーンアップを実行できること', async () => {
        const orchestrator = new WorktreeOrchestrator(mockSandbox);
        const envPath = '/path/to/worktree/test-score';
        
        await orchestrator.finalize(envPath, true);

        expect(mockSandbox.mergeEnvironment).toHaveBeenCalledWith(envPath);
        expect(mockSandbox.removeEnvironment).toHaveBeenCalledWith(envPath);
    });

    it('失敗時にマージせずにクリーンアップだけ実行できること', async () => {
        const orchestrator = new WorktreeOrchestrator(mockSandbox);
        const envPath = '/path/to/worktree/test-score';
        
        await orchestrator.finalize(envPath, false);

        expect(mockSandbox.mergeEnvironment).not.toHaveBeenCalled();
        expect(mockSandbox.removeEnvironment).toHaveBeenCalledWith(envPath);
    });
});
