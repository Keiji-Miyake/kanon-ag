import { createHash } from 'crypto';
import { SandboxRepository, EnvironmentConfig } from '../../domain/repositories/sandbox.js';

export class WorktreeManager {
    constructor(private sandboxRepository: SandboxRepository) { }

    /**
     * タスク名を Git ブランチ名として安全に使用できるようにサニタイズします。
     * @param taskId タスクのIDや識別子
     * @param maxLength 最大長（デフォルト: 64）
     * @returns サニタイズされたタスク名
     */
    private sanitizeTaskName(taskId: string, maxLength: number = 64): string {
        if (!taskId) {
            return `task-${Date.now()}`;
        }

        // 基本的なサニタイズ: 無効な文字をハイフンに、小文字化、連続ハイフンの集約、先頭/末尾のハイフン削除
        let safe = taskId
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!safe) {
            return `task-${Date.now()}`;
        }

        // 切り詰めが必要な場合、一意性を確保するためにハッシュ（最初の7文字）を付与
        if (safe.length > maxLength) {
            const hash = createHash('sha256').update(taskId).digest('hex').slice(0, 7);
            const prefix = safe.slice(0, maxLength - 8); // ハイフン + ハッシュの分（8文字）を引く
            safe = `${prefix}-${hash}`.replace(/-+$/g, ''); // 末尾のハイフンを念のため削除
        }

        return safe;
    }

    /**
     * 新しいタスク用の隔離環境をセットアップします。
     * @param taskId タスクのIDや識別子
     * @param baseBranch 分岐元のブランチ (デフォルト: main)
     * @returns サンドボックスの絶対パス
     */
    public async setupTaskEnvironment(taskId: string, baseBranch: string = 'main'): Promise<string> {
        const safeTaskId = this.sanitizeTaskName(taskId);
        const config: EnvironmentConfig = {
            baseBranch,
            environmentName: `kanon-task-${safeTaskId}`
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
