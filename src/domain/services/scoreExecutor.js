export class ScoreExecutor {
    score;
    currentPassage;
    ruleEngine;
    watchdog;
    constructor(score, ruleEngine, watchdog) {
        this.score = score;
        this.ruleEngine = ruleEngine;
        this.watchdog = watchdog;
        this.currentPassage = this.getPassage(score.initialPassage);
    }
    getCurrentPassage() {
        return this.currentPassage;
    }
    updateScore(score) {
        this.score = score;
    }
    getScore() {
        return this.score;
    }
    /**
     * 指定した Passage まで状態をスキップする（レジューム用）。
     */
    skipToPassage(passageName) {
        this.currentPassage = this.getPassage(passageName);
    }
    processOutput(output) {
        // 1. Check for stall
        if (this.watchdog.isStalled(output)) {
            return { nextPassageName: null, stalled: true };
        }
        // 2. Determine next passage from output JSON or passage rules
        let nextPassageName = this.ruleEngine.determineNextPassage(output, this.currentPassage);
        // 3. Fallback to fixed 'next' if no JSON result or rule matched
        if (!nextPassageName) {
            nextPassageName = this.currentPassage.next || null;
        }
        if (nextPassageName) {
            this.currentPassage = this.getPassage(nextPassageName);
        }
        return { nextPassageName, stalled: false };
    }
    getPassage(name) {
        const passage = this.score.passages.find(p => p.name === name);
        if (!passage) {
            throw new Error(`Passage '${name}' not found in score '${this.score.name}'`);
        }
        return passage;
    }
}
