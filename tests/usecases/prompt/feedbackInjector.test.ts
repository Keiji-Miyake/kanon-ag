import { describe, it, expect } from 'vitest';
import { FeedbackInjector } from '../../../src/usecases/prompt/feedbackInjector.js';
import { Instruction } from '../../../src/domain/models/promptFacet.js';
import { Issue } from '../../../src/domain/models/feedback.js';

describe('FeedbackInjector', () => {
    const injector = new FeedbackInjector();

    const baseInstruction: Instruction = {
        objective: 'オセロゲームを実装する',
        tasks: ['ゲームの盤面を初期化する', '石を置くロジックを実装する'],
    };

    it('Issues が空の場合、元の Instruction をそのまま返す', () => {
        const result = injector.injectIssues(baseInstruction, []);
        expect(result).toEqual(baseInstruction);
    });

    it('Issues を注入すると、objective の先頭に "[REVISION REQUIRED]" が付与される', () => {
        const issues: Issue[] = [
            { level: 'error', description: 'TypeScript のコンパイルエラーがある' },
        ];
        const result = injector.injectIssues(baseInstruction, issues);
        expect(result.objective).toBe('[REVISION REQUIRED] オセロゲームを実装する');
    });

    it('Issues が注入されると、tasks の末尾にフィードバック項目が追加される', () => {
        const issues: Issue[] = [
            { level: 'error', description: 'TypeScript のコンパイルエラーがある' },
        ];
        const result = injector.injectIssues(baseInstruction, issues);
        expect(result.tasks.length).toBe(baseInstruction.tasks.length + 1);
        expect(result.tasks[result.tasks.length - 1]).toContain('ADDRESS REVIEW FEEDBACK');
    });

    it('Issue の filePaths が含まれる場合、tasks の説明に含まれる', () => {
        const issues: Issue[] = [
            {
                level: 'error',
                description: '型エラーが発生',
                filePaths: ['src/game.ts'],
            },
        ];
        const result = injector.injectIssues(baseInstruction, issues);
        const lastTask = result.tasks[result.tasks.length - 1];
        expect(lastTask).toContain('src/game.ts');
    });

    it('Issue の lineNumber が含まれる場合、tasks の説明に含まれる', () => {
        const issues: Issue[] = [
            { level: 'warning', description: '非推奨の API を使用', lineNumber: 42 },
        ];
        const result = injector.injectIssues(baseInstruction, issues);
        const lastTask = result.tasks[result.tasks.length - 1];
        expect(lastTask).toContain('42');
    });

    it('Issue の suggestedFix が含まれる場合、tasks の説明に含まれる', () => {
        const issues: Issue[] = [
            { level: 'suggestion', description: '改善提案', suggestedFix: 'useCallback を使ってください' },
        ];
        const result = injector.injectIssues(baseInstruction, issues);
        const lastTask = result.tasks[result.tasks.length - 1];
        expect(lastTask).toContain('useCallback を使ってください');
    });

    it('複数の Issues を注入すると、全てが一つの task にまとめられる', () => {
        const issues: Issue[] = [
            { level: 'error', description: 'エラー1' },
            { level: 'warning', description: '警告1' },
        ];
        const result = injector.injectIssues(baseInstruction, issues);
        // tasks が元の数より1つだけ増えていること
        expect(result.tasks.length).toBe(baseInstruction.tasks.length + 1);
        const lastTask = result.tasks[result.tasks.length - 1];
        expect(lastTask).toContain('エラー1');
        expect(lastTask).toContain('警告1');
    });

    it('元の Instruction のタスクが変更されていないことを確認（イミュータブル）', () => {
        const issues: Issue[] = [{ level: 'error', description: 'エラー' }];
        injector.injectIssues(baseInstruction, issues);
        // 元のタスク数は変わらないこと
        expect(baseInstruction.tasks.length).toBe(2);
    });
});
