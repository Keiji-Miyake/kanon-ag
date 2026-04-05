export class ParallelRunner {
    runner;
    constructor(runner) {
        this.runner = runner;
    }
    async run(skills) {
        if (skills.length === 0) {
            return [];
        }
        // Parallel execution using Promise.all
        const tasks = skills.map(skill => this.runner(skill));
        return Promise.all(tasks);
    }
}
