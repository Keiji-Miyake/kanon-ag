import { SandboxRepository, EnvironmentConfig } from '../../domain/repositories/sandbox.js';

export class WorktreeManager {
    constructor(private sandboxRepository: SandboxRepository) { }

    /**
     * 新しいタスク用の隔離環境をセットアップします。
     * @param taskId タスクのIDや識別子
     * @param baseBranch 分岐元のブランチ (デフォルト: main)
     * @returns サンドボックスの絶対パス
     */
    public async setupTaskEnvironment(taskId: string, baseBranch: string = 'main'): Promise<string> {
        const config: EnvironmentConfig = {
            baseBranch,
            environmentName: `kanon-task-${taskId}`
        };
        return this.sandboxRepository.createEnvironment(config);
    }

    /**
     * 隔離環境の変更をコミットし、環境を破棄します。
     * @param environmentPath サンドボックスのパス
     * @param commitMessage コミットメッセージ
     */
    public async saveAndCleanup(environmentPath: string, commitMessage: string): Promise<boolean> {
        let saved = false;
        const isDirty = await this.sandboxRepository.isDirty(environmentPath);
        if (isDirty) {
            saved = await this.sandboxRepository.commitChanges(environmentPath, commitMessage);
        }
        await this.sandboxRepository.discardEnvironment(environmentPath);
        return saved;
    }

    /**
     * 隔離環境の変更を破棄し、クリーンアップします（アボート処理）。
     * @param environmentPath サンドボックスのパス
     */
    public async abortAndCleanup(environmentPath: string): Promise<void> {
        await this.sandboxRepository.discardEnvironment(environmentPath);
    }
}
