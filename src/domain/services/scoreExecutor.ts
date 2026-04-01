import { Score, Passage } from '../models/score.js';
import { RuleEngine } from './ruleEngine.js';
import { LoopWatchdog } from './loopWatchdog.js';

export class ScoreExecutor {
    private score: Score;
    private currentPassage: Passage;
    private ruleEngine: RuleEngine;
    private watchdog: LoopWatchdog;

    constructor(score: Score, ruleEngine: RuleEngine, watchdog: LoopWatchdog) {
        this.score = score;
        this.ruleEngine = ruleEngine;
        this.watchdog = watchdog;
        this.currentPassage = this.getPassage(score.initialPassage);
    }

    public getCurrentPassage(): Passage {
        return this.currentPassage;
    }

    /**
     * 指定した Passage まで状態をスキップする（レジューム用）。
     */
    public skipToPassage(passageName: string): void {
        this.currentPassage = this.getPassage(passageName);
    }

    public processOutput(output: string): { nextPassageName: string | null; stalled: boolean } {
        // 1. Check for stall
        if (this.watchdog.isStalled(output)) {
            return { nextPassageName: null, stalled: true };
        }

        // 2. Determine next passage from output JSON
        let nextPassageName = this.ruleEngine.determineNextPassage(output);

        // 3. Fallback to fixed 'next' if no JSON result
        if (!nextPassageName) {
            nextPassageName = this.currentPassage.next || null;
        }

        if (nextPassageName) {
            this.currentPassage = this.getPassage(nextPassageName);
        }

        return { nextPassageName, stalled: false };
    }

    private getPassage(name: string): Passage {
        const passage = this.score.passages.find(p => p.name === name);
        if (!passage) {
            throw new Error(`Passage '${name}' not found in score '${this.score.name}'`);
        }
        return passage;
    }
}
