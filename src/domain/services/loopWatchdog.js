import { createHash } from 'crypto';
export class LoopWatchdog {
    lastHash = null;
    count = 0;
    threshold;
    constructor(threshold = 3) {
        this.threshold = threshold;
    }
    isStalled(output) {
        const hash = this.computeHash(output);
        if (hash === this.lastHash) {
            this.count++;
        }
        else {
            this.lastHash = hash;
            this.count = 1;
        }
        return this.count >= this.threshold;
    }
    reset() {
        this.lastHash = null;
        this.count = 0;
    }
    computeHash(content) {
        return createHash('sha256').update(content).digest('hex');
    }
}
