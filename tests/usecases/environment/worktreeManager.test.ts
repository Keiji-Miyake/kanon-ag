import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../../../src/usecases/environment/worktreeManager.js';
import { SandboxRepository } from '../../../src/domain/repositories/sandbox.js';

describe('WorktreeManager', () => {
    let mockSandboxRepository: SandboxRepository;
    let worktreeManager: WorktreeManager;

    beforeEach(() => {
        mockSandboxRepository = {
            createEnvironment: vi.fn().mockResolvedValue('/path/to/sandbox'),
            commitChanges: vi.fn().mockResolvedValue(true),
            discardEnvironment: vi.fn().mockResolvedValue(undefined),
            isDirty: vi.fn().mockResolvedValue(true),
        };
        worktreeManager = new WorktreeManager(mockSandboxRepository);
    });

    describe('setupTaskEnvironment()', () => {
        it('通常のタスクIDを正しくサニタイズする', async () => {
            await worktreeManager.setupTaskEnvironment('Feature: User Login');
            expect(mockSandboxRepository.createEnvironment).toHaveBeenCalledWith({
                baseBranch: 'main',
                environmentName: 'kanon-task-feature-user-login',
            });
        });

        it('特殊文字をハイフンに置き換える', async () => {
            await worktreeManager.setupTaskEnvironment('task#123!@#$%^&*()');
            expect(mockSandboxRepository.createEnvironment).toHaveBeenCalledWith({
                baseBranch: 'main',
                environmentName: 'kanon-task-task-123',
            });
        });

        it('100文字を超える長いタスクIDを切り詰め、プレフィックス込みで適切な長さに収める', async () => {
            const longTaskId = 'a'.repeat(200);
            await worktreeManager.setupTaskEnvironment(longTaskId);
            
            const call = (mockSandboxRepository.createEnvironment as any).mock.calls[0][0];
            const envName = call.environmentName;
            
            // プレフィックス(11) + サニタイズ(64) = 75文字程度に収まるべき
            expect(envName.startsWith('kanon-task-')).toBe(true);
            expect(envName.length).toBeLessThanOrEqual(100);
            // ハッシュ（7文字）が含まれていることを確認
            const parts = envName.split('-');
            const hash = parts[parts.length - 1];
            expect(hash.length).toBe(7);
        });

        it('異なる長いタスクIDが、切り詰め後もハッシュによって区別される', async () => {
            const longTaskId1 = 'a'.repeat(200) + '1';
            const longTaskId2 = 'a'.repeat(200) + '2';
            
            await worktreeManager.setupTaskEnvironment(longTaskId1);
            await worktreeManager.setupTaskEnvironment(longTaskId2);
            
            const envName1 = (mockSandboxRepository.createEnvironment as any).mock.calls[0][0].environmentName;
            const envName2 = (mockSandboxRepository.createEnvironment as any).mock.calls[1][0].environmentName;
            
            expect(envName1).not.toBe(envName2);
        });

        it('末尾にドットがある場合に削除する', async () => {
            await worktreeManager.setupTaskEnvironment('my.task.');
            expect(mockSandboxRepository.createEnvironment).toHaveBeenCalledWith({
                baseBranch: 'main',
                environmentName: 'kanon-task-my-task', // 現状では `.` が `-` になり、末尾ハイフンが削除されるはず
            });
        });

        it('ユニコード文字をハイフンに置き換える', async () => {
            await worktreeManager.setupTaskEnvironment('タスク123');
            expect(mockSandboxRepository.createEnvironment).toHaveBeenCalledWith({
                baseBranch: 'main',
                environmentName: 'kanon-task-123', // 現状では日本語が `---` になり、一つに集約されるはず
            });
        });
        
        it('連続したハイフンを一つに集約する', async () => {
            await worktreeManager.setupTaskEnvironment('task---name');
            expect(mockSandboxRepository.createEnvironment).toHaveBeenCalledWith({
                baseBranch: 'main',
                environmentName: 'kanon-task-task-name',
            });
        });

        it('空のタスクIDの場合、タイムスタンプベースのIDを使用する', async () => {
            await worktreeManager.setupTaskEnvironment('');
            const call = (mockSandboxRepository.createEnvironment as any).mock.calls[0][0];
            expect(call.environmentName).toMatch(/^kanon-task-task-\d+$/);
        });

        it('サニタイズ後に空になるタスクIDの場合、タイムスタンプベースのIDを使用する', async () => {
            await worktreeManager.setupTaskEnvironment('!!!');
            const call = (mockSandboxRepository.createEnvironment as any).mock.calls[0][0];
            expect(call.environmentName).toMatch(/^kanon-task-task-\d+$/);
        });
    });

    describe('saveAndCleanup()', () => {
        it('変更がある場合、コミットしてクリーンアップする', async () => {
            vi.mocked(mockSandboxRepository.isDirty).mockResolvedValue(true);
            const saved = await worktreeManager.saveAndCleanup('/path/to/env', 'commit message');
            
            expect(mockSandboxRepository.isDirty).toHaveBeenCalledWith('/path/to/env');
            expect(mockSandboxRepository.commitChanges).toHaveBeenCalledWith('/path/to/env', 'commit message');
            expect(mockSandboxRepository.discardEnvironment).toHaveBeenCalledWith('/path/to/env');
            expect(saved).toBe(true);
        });

        it('変更がない場合、コミットせずにクリーンアップする', async () => {
            vi.mocked(mockSandboxRepository.isDirty).mockResolvedValue(false);
            const saved = await worktreeManager.saveAndCleanup('/path/to/env', 'commit message');
            
            expect(mockSandboxRepository.isDirty).toHaveBeenCalledWith('/path/to/env');
            expect(mockSandboxRepository.commitChanges).not.toHaveBeenCalled();
            expect(mockSandboxRepository.discardEnvironment).toHaveBeenCalledWith('/path/to/env');
            expect(saved).toBe(false);
        });
    });

    describe('abortAndCleanup()', () => {
        it('環境を破棄する', async () => {
            await worktreeManager.abortAndCleanup('/path/to/env');
            expect(mockSandboxRepository.discardEnvironment).toHaveBeenCalledWith('/path/to/env');
        });
    });
});
