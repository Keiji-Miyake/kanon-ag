import { describe, it, expect } from 'vitest';
import { ConsensusService } from '../../../src/domain/services/consensusService.js';

describe('ConsensusService', () => {
    const service = new ConsensusService();

    it('複数のエージェント出力を Supervisor 向けのプロンプトに統合できること', () => {
        const agentOutputs = [
            { skill: 'melchior', output: 'I approve this plan.' },
            { skill: 'balthasar', output: 'I have some concerns about security.' },
            { skill: 'casper', output: 'Proceed with caution.' }
        ];

        const prompt = service.buildSupervisorPrompt(agentOutputs);

        expect(prompt).toContain('# Consensus Deliberation');
        expect(prompt).toContain('## Output from melchior');
        expect(prompt).toContain('I approve this plan.');
        expect(prompt).toContain('## Output from balthasar');
        expect(prompt).toContain('I have some concerns about security.');
        expect(prompt).toContain('## Output from casper');
        expect(prompt).toContain('Proceed with caution.');
        expect(prompt).toContain('json:passage-result');
    });

    it('再審議用のコンテキストを構築できること', () => {
        const agentOutputs = [
            { skill: 's1', output: 'Opinion A' },
            { skill: 's2', output: 'Opinion B' }
        ];

        const feedback = service.buildDeliberationFeedback('s1', agentOutputs);

        expect(feedback).toContain('Other agents provided the following feedback');
        expect(feedback).toContain('Output from s2');
        expect(feedback).toContain('Opinion B');
        expect(feedback).not.toContain('Output from s1'); // 自分自身の出力は含まない
    });
});
