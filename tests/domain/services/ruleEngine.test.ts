import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../../src/domain/services/ruleEngine.js';
import { Rule, Passage } from '../../../src/domain/models/score.js';

describe('RuleEngine', () => {
    const ruleEngine = new RuleEngine();

    describe('determineNextPassage', () => {
        it('エージェントの出力から JSON ブロックを抽出し、次の Passage を決定できること', () => {
            const output = `
分析が完了しました。
次の方針に従って進めます。

\`\`\`json:passage-result
{
  "next_passage": "implement_feature",
  "reason": "要件が明確なため実装に進みます"
}
\`\`\`
`;
            const result = ruleEngine.determineNextPassage(output);
            expect(result).toBe('implement_feature');
        });

        it('Passage に定義されたルールを優先評価すること', () => {
            const output = `
\`\`\`json:passage-result
{
  "score": 85,
  "next_passage": "default_next"
}
\`\`\`
`;
            const currentPassage: Passage = {
                name: 'current',
                prompt_facets: [],
                rules: [
                    {
                        condition: { field: 'score', operator: 'gt', value: 80 },
                        next: 'high_score_passage'
                    }
                ]
            };
            const result = ruleEngine.determineNextPassage(output, currentPassage);
            expect(result).toBe('high_score_passage');
        });

        it('JSON ブロックが存在しない場合、null を返すこと', () => {
            const output = 'ただのテキストメッセージです。';
            const result = ruleEngine.determineNextPassage(output);
            expect(result).toBeNull();
        });

        it('next_passage が指定されていない場合、null を返すこと', () => {
            const output = '\`\`\`json:passage-result\n{"reason": "nothing"}\n\`\`\`';
            const result = ruleEngine.determineNextPassage(output);
            expect(result).toBeNull();
        });

        it('不正な JSON の場合、エラーを投げずに null を返すこと', () => {
            const output = '\`\`\`json:passage-result\n{ invalid json }\n\`\`\`';
            const result = ruleEngine.determineNextPassage(output);
            expect(result).toBeNull();
        });
    });

    describe('evaluateRule', () => {
        const data = {
            count: 10,
            status: 'success',
            tags: ['typescript', 'vitest'],
            description: 'This is a test',
            result: {
                status: 'done',
                details: {
                    score: 95
                }
            }
        };

        it('eq: 一致する場合に true を返すこと', () => {
            const rule: Rule = { condition: { field: 'status', operator: 'eq', value: 'success' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('eq: 一致しない場合に false を返すこと', () => {
            const rule: Rule = { condition: { field: 'status', operator: 'eq', value: 'error' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(false);
        });

        it('neq: 一致しない場合に true を返すこと', () => {
            const rule: Rule = { condition: { field: 'status', operator: 'neq', value: 'error' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('neq: 一致する場合に false を返すこと', () => {
            const rule: Rule = { condition: { field: 'status', operator: 'neq', value: 'success' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(false);
        });

        it('contains (string): 文字列が含まれる場合に true を返すこと', () => {
            const rule: Rule = { condition: { field: 'description', operator: 'contains', value: 'test' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('contains (array): 配列に要素が含まれる場合に true を返すこと', () => {
            const rule: Rule = { condition: { field: 'tags', operator: 'contains', value: 'typescript' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('gt: 数値がより大きい場合に true を返すこと', () => {
            const rule: Rule = { condition: { field: 'count', operator: 'gt', value: 5 }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('gt: 数値が等しい場合に false を返すこと', () => {
            const rule: Rule = { condition: { field: 'count', operator: 'gt', value: 10 }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(false);
        });

        it('lt: 数値がより小さい場合に true を返すこと', () => {
            const rule: Rule = { condition: { field: 'count', operator: 'lt', value: 15 }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('lt: 数値が等しい場合に false を返すこと', () => {
            const rule: Rule = { condition: { field: 'count', operator: 'lt', value: 10 }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(false);
        });

        it('ドット記法によるネストされたフィールドの評価ができること', () => {
            const rule1: Rule = { condition: { field: 'result.status', operator: 'eq', value: 'done' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule1, data)).toBe(true);

            const rule2: Rule = { condition: { field: 'result.details.score', operator: 'gt', value: 90 }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule2, data)).toBe(true);
        });

        it('存在しないパスを指定した場合、undefined として扱われ、適切に評価されること', () => {
            const rule: Rule = { condition: { field: 'non.existent.path', operator: 'eq', value: undefined }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(true);
        });

        it('プロトタイプ汚染対策: __proto__ へのアクセスがブロックされること', () => {
            const rule: Rule = { condition: { field: '__proto__.polluted', operator: 'eq', value: 'value' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(false);
        });

        it('プロトタイプ汚染対策: constructor へのアクセスがブロックされること', () => {
            const rule: Rule = { condition: { field: 'constructor.name', operator: 'eq', value: 'Object' }, next: 'next' };
            expect(ruleEngine.evaluateRule(rule, data)).toBe(false);
        });
    });
});
