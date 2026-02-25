import { SandboxRepository, EnvironmentConfig } from '../../domain/repositories/sandbox.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execFileAsync = promisify(execFile);

export class LocalGitSandbox implements SandboxRepository {
    private basePath: string;
    private environmentToBaseBranch: Map<string, string> = new Map();

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    public async createEnvironment(config: EnvironmentConfig): Promise<string> {
        const worktreePath = path.resolve(this.basePath, '..', config.environmentName);

        await fs.mkdir(path.dirname(worktreePath), { recursive: true });

        try {
            // ブランチが存在するか確認
            await execFileAsync('git', ['show-ref', '--verify', `refs/heads/${config.environmentName}`], { cwd: this.basePath });
            // 存在する場合は作成済みのブランチからworktreeを作成
            await execFileAsync('git', ['worktree', 'add', worktreePath, config.environmentName], { cwd: this.basePath });
        } catch {
            // 存在しない場合はベースブランチから新しいブランチを作成してworktreeを生成
            await execFileAsync('git', ['worktree', 'add', '-b', config.environmentName, worktreePath, config.baseBranch], { cwd: this.basePath });
        }

        this.environmentToBaseBranch.set(worktreePath, config.baseBranch);
        return worktreePath;
    }

    public async commitChanges(environmentPath: string, message: string): Promise<boolean> {
        try {
            await execFileAsync('git', ['add', '.'], { cwd: environmentPath });
            const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: environmentPath });

            if (status.stdout.trim() === '') {
                return false; // コミットする変更なし
            }

            await execFileAsync('git', ['commit', '-m', message], { cwd: environmentPath });

            // メインリポジトリへマージ
            const baseBranch = this.environmentToBaseBranch.get(environmentPath);
            if (baseBranch) {
                const environmentName = path.basename(environmentPath);
                // メインリポジトリでベースブランチに切り替え、マージする
                // 注意: ワークツリーがある間はメインリポジトリでそのブランチをチェックアウトできないため、
                // ベースブランチにマージすること自体は可能（メインリポジトリが別のブランチにいれば）
                await execFileAsync('git', ['checkout', baseBranch], { cwd: this.basePath });
                await execFileAsync('git', ['merge', environmentName], { cwd: this.basePath });
            }

            return true;
        } catch (error) {
            console.error(`LocalGitSandbox: commitChanges failed:`, error);
            return false;
        }
    }

    public async discardEnvironment(environmentPath: string): Promise<void> {
        try {
            await execFileAsync('git', ['worktree', 'remove', '-f', environmentPath], { cwd: this.basePath });
        } catch (error) {
            console.error(`LocalGitSandbox: discardEnvironment failed:`, error);
        }
    }

    public async isDirty(environmentPath: string): Promise<boolean> {
        try {
            const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: environmentPath });
            return status.stdout.trim() !== '';
        } catch (error) {
            console.error(`LocalGitSandbox: isDirty failed:`, error);
            return false;
        }
    }
}
