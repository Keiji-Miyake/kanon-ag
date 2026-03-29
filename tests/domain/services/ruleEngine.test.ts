import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../../src/domain/services/ruleEngine.js';

describe('RuleEngine', () => {
    const ruleEngine = new RuleEngine();

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
