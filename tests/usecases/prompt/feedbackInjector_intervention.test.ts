import { describe, it, expect } from 'vitest';
import { FeedbackInjector } from '../../../src/usecases/prompt/feedbackInjector.js';
import { Instruction } from '../../../src/domain/models/promptFacet.js';

describe('FeedbackInjector User Intervention', () => {
    const injector = new FeedbackInjector();

    const baseInstruction: Instruction = {
        objective: 'オセロゲームを実装する',
        tasks: ['ゲームの盤面を初期化する', '石を置くロジックを実装する'],
    };

    it('ユーザーの介入メッセージ（文字列）を注入できる', () => {
        const userMessage = 'UIのボタンをもっと大きくしてください';
        const result = injector.injectUserIntervention(baseInstruction, userMessage);
        
        expect(result.objective).toBe('[USER INTERVENTION] オセロゲームを実装する');
        expect(result.tasks.length).toBe(baseInstruction.tasks.length + 1);
        const lastTask = result.tasks[result.tasks.length - 1];
        expect(lastTask).toContain('USER INTERVENTION');
        expect(lastTask).toContain(userMessage);
    });

    it('空のメッセージの場合は元の Instruction をそのまま返す', () => {
        const result = injector.injectUserIntervention(baseInstruction, '');
        expect(result).toEqual(baseInstruction);
    });
});
