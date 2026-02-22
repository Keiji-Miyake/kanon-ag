export interface EnvironmentConfig {
    baseBranch: string;
    environmentName: string; // 例: task-123 や feat/xyz
}

export interface SandboxRepository {
    /**
     * 新しい隔離環境（例: Git Worktree）を作成します。
     * サンドボックスのワークスペースへの絶対パスを返します。
     */
    createEnvironment(config: EnvironmentConfig): Promise<string>;

    /**
     * 変更をコミットし、メインリポジトリまたはブランチへマージします。
     */
    commitChanges(environmentPath: string, message: string): Promise<boolean>;

    /**
     * 環境とマージされていないすべての変更を破棄します。
     */
    discardEnvironment(environmentPath: string): Promise<void>;

    /**
     * 環境にアクティブなプロセスやコミットされていない変更があるかをチェックします。
     */
    isDirty(environmentPath: string): Promise<boolean>;
}
