import { createHash } from 'crypto';

export class LoopWatchdog {
    private lastHash: string | null = null;
    private count: number = 0;
    private threshold: number;

    constructor(threshold: number = 3) {
        this.threshold = threshold;
    }

    public isStalled(output: string): boolean {
        const hash = this.computeHash(output);

        if (hash === this.lastHash) {
            this.count++;
        } else {
            this.lastHash = hash;
            this.count = 1;
        }

        return this.count >= this.threshold;
    }

    private computeHash(content: string): string {
        return createHash('sha256').update(content).digest('hex');
    }
}
