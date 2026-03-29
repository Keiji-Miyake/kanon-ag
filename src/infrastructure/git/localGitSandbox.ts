import { SandboxRepository, EnvironmentConfig } from '../../domain/repositories/sandbox.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execFileAsync = promisify(execFile);

export class LocalGitSandbox implements SandboxRepository {
    private basePath: string;

    private worktreeDir: string;
    private environmentToBaseBranch: Map<string, string> = new Map();

    constructor(basePath: string, worktreeDir: string = 'worktree') {
        this.basePath = path.resolve(basePath);
        this.worktreeDir = worktreeDir;
    }

    /**
     * ブランチ名をサニタイズするユーティリティ
     * - NFKC 正規化で全角→半角等を変換
     * - 英字は小文字化
     * - 空白/ドットをハイフン化、連続ハイフンを潰す
     * - スラッシュ/アンダースコアは保持
     * - 不正な文字のみになる場合は 'task' を返す
     */
    public sanitizeBranchName(name: string): string {
        if (!name || typeof name !== 'string') return 'task';
        // Unicode 正規化で全角→半角等を簡易変換
        let s = name.normalize('NFKC');
        s = s.trim();
        // Replace dots and whitespace sequences with hyphen
        s = s.replace(/\s+/g, '-').replace(/\./g, '-');
        // Remove characters except letters, numbers, hyphen, slash, underscore, and CJK characters
        // Allow Unicode letters (\\p{L}), numbers (\\p{N}), hyphen, slash, underscore
        s = s.replace(/[^
\p{L}\p{N}\/\-_\-]+/gu, '');
        // Lowercase ASCII letters
        s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
        // Collapse multiple hyphens
        s = s.replace(/-+/g, '-');
        // Trim leading/trailing hyphens and spaces
        s = s.replace(/^-+|-+$/g, '');

        if (!s) return 'task';
        return s;
    }

    public async createEnvironment(config: EnvironmentConfig): Promise<string> {
        const sanitizedName = this.sanitizeBranchName(config.environmentName);
        const worktreePath = path.resolve(this.basePath, this.worktreeDir, sanitizedName);

        await fs.mkdir(path.dirname(worktreePath), { recursive: true });

        try {
            // ブランチが存在するか確認
            await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${sanitizedName}`], { cwd: this.basePath });
            // 既存ブランチからworktree作成
            await execFileAsync('git', ['worktree', 'add', worktreePath, sanitizedName], { cwd: this.basePath });
        } catch {
            // 新規ブランチとしてworktree作成
            await execFileAsync('git', ['worktree', 'add', '-b', sanitizedName, worktreePath, config.baseBranch || 'main'], { cwd: this.basePath });
        }

        this.environmentToBaseBranch.set(worktreePath, config.baseBranch || 'main');
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
