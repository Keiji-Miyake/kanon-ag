import { describe, it, expect } from 'vitest';
import { ConsensusService, AgentOutput } from '../../../src/domain/services/consensusService.js';

describe('ConsensusService', () => {
    const service = new ConsensusService();

    it('should build supervisor prompt from outputs', () => {
        const outputs: AgentOutput[] = [
            { skill: 'melchior', output: 'Option A is better because...' },
            { skill: 'balthasar', output: 'Option B is better because...' },
        ];
        const prompt = service.buildSupervisorPrompt(outputs);
        
        expect(prompt).toContain('melchior');
        expect(prompt).toContain('Option A');
        expect(prompt).toContain('balthasar');
        expect(prompt).toContain('Option B');
        expect(prompt).toContain('deliberation');
    });

    it('should build deliberation feedback for a specific agent', () => {
        const context: AgentOutput[] = [
            { skill: 'melchior', output: 'My plan is X.' },
            { skill: 'balthasar', output: 'I disagree with X because Y.' },
        ];
        const feedback = service.buildDeliberationFeedback('melchior', context);
        
        expect(feedback).toContain('balthasar');
        expect(feedback).toContain('I disagree with X because Y.');
        expect(feedback).not.toContain('My plan is X.'); // 自分の出力は含まない
    });
});
