import { describe, it, expect } from 'vitest';
import { ScoreExecutor } from '../../../src/domain/services/scoreExecutor.js';
import { RuleEngine } from '../../../src/domain/services/ruleEngine.js';
import { LoopWatchdog } from '../../../src/domain/services/loopWatchdog.js';
import { Score } from '../../../src/domain/models/score.js';

describe('ScoreExecutor', () => {
    const testScore: Score = {
        name: 'Test Score',
        description: 'Testing ScoreExecutor',
        initialPassage: 'p1',
        passages: [
            { name: 'p1', displayName: 'Passage 1', skill: 's1', next: 'p2' },
            { name: 'p2', displayName: 'Passage 2', skill: 's2' },
            { name: 'p3', displayName: 'Passage 3', skill: 's3' }
        ]
    };

    it('初期 Passage が設定されていること', () => {
        const executor = new ScoreExecutor(testScore, new RuleEngine(), new LoopWatchdog());
        expect(executor.getCurrentPassage().name).toBe('p1');
    });

    it('JSON 出力に基づいて次の Passage へ遷移すること', () => {
        const executor = new ScoreExecutor(testScore, new RuleEngine(), new LoopWatchdog());
        const output = '\`\`\`json:passage-result\n{ "next_passage": "p3" }\n\`\`\`';
        
        const result = executor.processOutput(output);
        expect(result.nextPassageName).toBe('p3');
        expect(executor.getCurrentPassage().name).toBe('p3');
    });

    it('JSON 出力がない場合、固定の next に基づいて遷移すること', () => {
        const executor = new ScoreExecutor(testScore, new RuleEngine(), new LoopWatchdog());
        const output = 'ただのテキスト';
        
        const result = executor.processOutput(output);
        expect(result.nextPassageName).toBe('p2');
        expect(executor.getCurrentPassage().name).toBe('p2');
    });

    it('同一ハッシュが連続した場合、停滞と判定されること', () => {
        const watchdog = new LoopWatchdog(2); // 2回連続で停滞判定
        const executor = new ScoreExecutor(testScore, new RuleEngine(), watchdog);
        const output = 'Stalled Output';
        
        expect(executor.processOutput(output).stalled).toBe(false); // 1回目
        expect(executor.processOutput(output).stalled).toBe(true);  // 2回目
    });
});
