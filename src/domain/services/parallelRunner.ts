export type SingleRunner = (skill: string) => Promise<string>;

export class ParallelRunner {
    private runner: SingleRunner;

    constructor(runner: SingleRunner) {
        this.runner = runner;
    }

    public async run(skills: string[]): Promise<string[]> {
        if (skills.length === 0) {
            return [];
        }

        // Parallel execution using Promise.all
        const tasks = skills.map(skill => this.runner(skill));
        return Promise.all(tasks);
    }
}
