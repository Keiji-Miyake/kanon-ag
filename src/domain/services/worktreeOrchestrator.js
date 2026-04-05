export class WorktreeOrchestrator {
    sandbox;
    constructor(sandbox) {
        this.sandbox = sandbox;
    }
    /**
     * Score 用のサンドボックス（ワークツリー）をセットアップする。
     */
    async setup(scoreName) {
        const timestamp = Date.now();
        const baseName = this.sandbox.sanitizeBranchName(scoreName);
        const environmentName = `kanon-task-${baseName}-${timestamp}`;
        return this.sandbox.createEnvironment({
            environmentName,
            baseBranch: 'main' // TODO: 現在のブランチを取得するように拡張可能
        });
    }
    /**
     * サンドボックスの結果を確定させ、後処理を行う。
     * @param environmentPath ワークツリーのパス
     * @param success 成功した場合はマージを試みる
     */
    async finalize(environmentPath, success) {
        try {
            if (success) {
                // 成功した場合はマージ
                await this.sandbox.mergeEnvironment(environmentPath);
            }
        }
        finally {
            // 成否に関わらずワークツリーは削除
            await this.sandbox.removeEnvironment(environmentPath);
        }
    }
}
