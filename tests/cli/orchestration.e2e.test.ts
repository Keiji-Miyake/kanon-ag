import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { WorktreeManager } from '../../src/usecases/environment/worktreeManager.js';
import { LocalGitSandbox } from '../../src/infrastructure/git/localGitSandbox.js';
import { ReviewOrchestrator, AgentRunner } from '../../src/usecases/orchestration/reviewOrchestrator.js';
import { AgentId } from '../../src/domain/models/agentState.js';
import { Instruction } from '../../src/domain/models/promptFacet.js';
import { ReviewFeedback } from '../../src/domain/models/feedback.js';

class MockAgentRunner implements AgentRunner {
    private implementationCount = 0;
    private failFirstReview = true;

    constructor(failFirstReview: boolean = true) {
        this.failFirstReview = failFirstReview;
    }

    public async runImplementation(_agentId: AgentId, worktreePath: string, _instruction: Instruction): Promise<void> {
        this.implementationCount++;
        const testFile = path.join(worktreePath, 'test.txt');
        fs.writeFileSync(testFile, `Implementation ${this.implementationCount}`);
    }

    public async runReview(agentId: AgentId, _worktreePath: string, _currentInstruction: Instruction): Promise<ReviewFeedback> {
        if (this.failFirstReview && this.implementationCount === 1) {
            return {
                reviewerId: agentId,
                targetAgentId: 'developer',
                taskId: 'current',
                status: 'rejected',
                issues: [{
                    level: 'error',
                    description: 'The implementation is incomplete.',
                    suggestedFix: 'Add more details to test.txt'
                }]
            };
        }

        return {
            reviewerId: agentId,
            targetAgentId: 'developer',
            taskId: 'current',
            status: 'approved',
            issues: []
        };
    }

    public getImplementationCount(): number {
        return this.implementationCount;
    }
}

describe('New Architecture E2E', () => {
    const tempDir = path.join(process.cwd(), '.tmp-e2e-vitest');

    beforeEach(() => {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir);
        execSync('git init && git checkout -b main', { cwd: tempDir });
        fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo');
        execSync('git add README.md && git commit -m "initial commit"', { cwd: tempDir });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should complete the correction loop and merge changes', async () => {
        const sandbox = new LocalGitSandbox(tempDir);
        const worktreeMgr = new WorktreeManager(sandbox);
        const runner = new MockAgentRunner(true);
        
        const orchestrator = new ReviewOrchestrator(
            'e2e-session',
            ['reviewer-1'],
            runner
        );

        const taskName = 'e2e-task';
        const worktreePath = await worktreeMgr.setupTaskEnvironment(taskName, 'main');

        const instruction: Instruction = {
            objective: 'Create test.txt',
            tasks: ['Write something to test.txt']
        };

        const success = await orchestrator.runCorrectionLoop(
            'developer',
            worktreePath,
            instruction,
            { type: 'all', targetAgents: ['reviewer-1'] },
            3
        );

        expect(success).toBe(true);
        expect(runner.getImplementationCount()).toBe(2);

        const content = fs.readFileSync(path.join(worktreePath, 'test.txt'), 'utf-8');
        expect(content).toBe('Implementation 2');

        await worktreeMgr.saveAndCleanup(worktreePath, 'feat: Add test.txt');

        const log = execSync('git log -n 1 --pretty=format:%s', { cwd: tempDir }).toString();
        expect(log).toBe('feat: Add test.txt');
    });
});
