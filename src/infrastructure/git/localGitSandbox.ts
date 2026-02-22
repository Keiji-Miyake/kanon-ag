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

    public async createEnvironment(config: EnvironmentConfig): Promise<string> {
        const sanitizedEnvName = this.sanitizeBranchName(config.environmentName);
        const worktreePath = path.resolve(this.basePath, this.worktreeDir, sanitizedEnvName);

        try {
            // ディレクトリが既に存在し、かつGitワークツリーとして有効か確認する
            const stats = await fs.stat(worktreePath).catch(() => null);
            if (stats && stats.isDirectory()) {
                // そのディレクトリがGitのワークツリーであるかをチェック
                await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: worktreePath });
                // 既に有効なワークツリーとして存在する場合はそのまま再利用
                this.environmentToBaseBranch.set(worktreePath, config.baseBranch || 'main');
                return worktreePath;
            }
        } catch {
            // もしディレクトリが存在するが有効なワークツリーでない場合は一旦削除する処理などを入れることも可能。
            // 今回は単純に再利用不可の場合はそのまま下へ進む（既存のworktree addに任せる）
        }

        await fs.mkdir(path.dirname(worktreePath), { recursive: true });

        try {
            // ブランチが存在するか確認
            await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${sanitizedEnvName}`], { cwd: this.basePath });
            // 既存ブランチからworktree作成
            await execFileAsync('git', ['worktree', 'add', worktreePath, sanitizedEnvName], { cwd: this.basePath });
        } catch {
            // 新規ブランチとしてworktree作成
            await execFileAsync('git', ['worktree', 'add', '-b', sanitizedEnvName, worktreePath, config.baseBranch || 'main'], { cwd: this.basePath });
        }

        this.environmentToBaseBranch.set(worktreePath, config.baseBranch || 'main');
        return worktreePath;
    }

    private sanitizeBranchName(name: string): string {
        // 先頭と末尾の空白を削除
        let sanitized = name.trim();
        
        // 全角英数字を半角に変換
        sanitized = sanitized.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
        
        // 英数字、ハイフン、アンダースコア、スラッシュ以外をハイフンに置換
        sanitized = sanitized.replace(/[\x20\x21-\x2C\x2E\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]/g, '-');

        // 連続するハイフンやアンダースコアをそれぞれ一つにまとめる
        sanitized = sanitized.replace(/-+/g, '-');
        sanitized = sanitized.replace(/_+/g, '_');
        
        // 全て小文字化
        sanitized = sanitized.toLowerCase();
        
        // 先頭と末尾のハイフン・スラッシュ・アンダースコアを削除
        sanitized = sanitized.replace(/^[/\-_]+|[/\-_]+$/g, '');
        
        // 全て消えてしまった場合はデフォルト名を設定
        if (!sanitized) {
            sanitized = 'task';
        }
        return sanitized;
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
