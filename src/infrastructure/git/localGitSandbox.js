import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
const execFileAsync = promisify(execFile);
export class LocalGitSandbox {
    basePath;
    worktreeDir;
    environmentToBaseBranch = new Map();
    constructor(basePath, worktreeDir = 'worktree') {
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
    sanitizeBranchName(name) {
        if (!name || typeof name !== 'string')
            return 'task';
        // Unicode 正規化で全角→半角等を簡易変換
        let s = name.normalize('NFKC');
        s = s.trim();
        // Replace dots and whitespace sequences with hyphen
        s = s.replace(/\s+/g, '-').replace(/\./g, '-');
        // Remove characters except letters, numbers, hyphen, slash, underscore, and common Unicode letters/numbers
        // Use Unicode property escapes to allow letters and numbers from all scripts
        s = s.replace(/[^\p{L}\p{N}\/\-_]+/gu, '');
        // Lowercase ASCII letters
        s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
        // Collapse multiple hyphens
        s = s.replace(/-+/g, '-');
        // Trim leading/trailing hyphens and spaces
        s = s.replace(/^-+|-+$/g, '');
        if (!s)
            return 'task';
        // 英字または数字が含まれているか（Unicode 対応）。含まれない場合は 'task' を返す
        if (!/[\p{L}\p{N}]/u.test(s))
            return 'task';
        return s;
    }
    async createEnvironment(config) {
        const sanitizedName = this.sanitizeBranchName(config.environmentName);
        const worktreePath = path.resolve(this.basePath, this.worktreeDir, sanitizedName);
        await fs.mkdir(path.dirname(worktreePath), { recursive: true });
        try {
            // ブランチが存在するか確認
            await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${sanitizedName}`], { cwd: this.basePath });
            // 既存ブランチからworktree作成
            await execFileAsync('git', ['worktree', 'add', worktreePath, sanitizedName], { cwd: this.basePath });
        }
        catch {
            // 新規ブランチとしてworktree作成
            await execFileAsync('git', ['worktree', 'add', '-b', sanitizedName, worktreePath, config.baseBranch || 'main'], { cwd: this.basePath });
        }
        this.environmentToBaseBranch.set(worktreePath, config.baseBranch || 'main');
        return worktreePath;
    }
    async commitChanges(environmentPath, message) {
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
        }
        catch (error) {
            console.error(`LocalGitSandbox: commitChanges failed:`, error);
            return false;
        }
    }
    async discardEnvironment(environmentPath) {
        try {
            await execFileAsync('git', ['worktree', 'remove', '-f', environmentPath], { cwd: this.basePath });
            // Remove the directory if it still exists (sometimes worktree remove leaves empty dirs)
            await fs.rm(environmentPath, { recursive: true, force: true }).catch(() => { });
        }
        catch (error) {
            console.error(`LocalGitSandbox: discardEnvironment failed:`, error);
        }
    }
    /**
     * 指定された環境（ブランチ）をベースブランチにマージする。
     */
    async mergeEnvironment(environmentPath) {
        const baseBranch = this.environmentToBaseBranch.get(environmentPath);
        if (!baseBranch) {
            throw new Error(`Base branch unknown for environment: ${environmentPath}`);
        }
        const branchName = path.basename(environmentPath);
        try {
            // メインリポジトリでベースブランチに切り替え
            await execFileAsync('git', ['checkout', baseBranch], { cwd: this.basePath });
            // マージ実行
            await execFileAsync('git', ['merge', branchName], { cwd: this.basePath });
        }
        catch (error) {
            console.error(`LocalGitSandbox: mergeEnvironment failed:`, error);
            throw error;
        }
    }
    /**
     * ワークツリーとそれに関連するブランチを完全に削除する。
     */
    async removeEnvironment(environmentPath) {
        const branchName = path.basename(environmentPath);
        await this.discardEnvironment(environmentPath);
        try {
            await execFileAsync('git', ['branch', '-D', branchName], { cwd: this.basePath });
        }
        catch (error) {
            // Branch might have been deleted or not exist
        }
    }
    async isDirty(environmentPath) {
        try {
            const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: environmentPath });
            return status.stdout.trim() !== '';
        }
        catch (error) {
            console.error(`LocalGitSandbox: isDirty failed:`, error);
            return false;
        }
    }
}
