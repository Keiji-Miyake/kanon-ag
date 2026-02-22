import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalGitSandbox } from '../../../src/infrastructure/git/localGitSandbox.js';
import * as child_process from 'child_process';
import * as fs from 'fs/promises';

// モック化
vi.mock('child_process', () => ({
    execFile: vi.fn((cmd, args, options, callback) => {
        if (callback) callback(null, { stdout: '', stderr: '' });
    })
}));

vi.mock('fs/promises', () => ({
    mkdir: vi.fn()
}));

// sanitizeBranchNameメソッドにアクセスできるようにキャスト
type LocalGitSandboxWithSanitize = LocalGitSandbox & { sanitizeBranchName(name: string): string };

describe('LocalGitSandbox', () => {
    let sandbox: LocalGitSandbox;

    beforeEach(() => {
        vi.clearAllMocks();
        sandbox = new LocalGitSandbox('/fake/base/path', 'worktree');
    });

    describe('sanitizeBranchName', () => {
        const testSanitize = (input: string, expected: string) => {
            it(`should sanitize "${input}" to "${expected}"`, () => {
                expect((sandbox as any).sanitizeBranchName(input)).toBe(expected);
            });
        };

        testSanitize('Feature/My New Task!', 'feature/my-new-task');
        testSanitize('日本語のテスト', '日本語のテスト');
        testSanitize('  space  around  ', 'space-around');
        testSanitize('A.B.C', 'a-b-c');
        testSanitize('--- multiple-hyphens ---', 'multiple-hyphens');
        testSanitize('全角１２３ＡＢＣ', '全角123abc');
        testSanitize('feat/user_auth', 'feat/user_auth');
        testSanitize('!@#$%^&*()_+', 'task');
    });

    describe('createEnvironment', () => {
        it('should create environment with sanitized name', async () => {
            const config = { environmentName: 'My Bad Task Name!', baseBranch: 'main' };
            const worktreePath = await sandbox.createEnvironment(config);

            expect(worktreePath).toMatch(/my-bad-task-name$/);
            expect(child_process.execFile).toHaveBeenCalled();
            // 呼び出された引数を検証（`refs/heads/my-bad-task-name` が含まれるはず）
            const calls = vi.mocked(child_process.execFile).mock.calls;
            const hasExpectedArg = calls.some(call => {
                const args = call[1] as string[];
                return args && args.some(arg => typeof arg === 'string' && arg.includes('my-bad-task-name'));
            });
            expect(hasExpectedArg).toBe(true);
        });
    });
});
