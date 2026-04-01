import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

import { Score, Passage } from '../../domain/models/score.js';
import { ScoreExecutor } from '../../domain/services/scoreExecutor.js';
import { RuleEngine } from '../../domain/services/ruleEngine.js';
import { LoopWatchdog } from '../../domain/services/loopWatchdog.js';
import { PromptAssembler } from '../../domain/services/promptAssembler.js';
import { ParallelRunner } from '../../domain/services/parallelRunner.js';
import { ConsensusService, AgentOutput } from '../../domain/services/consensusService.js';
import { WorktreeOrchestrator } from '../../domain/services/worktreeOrchestrator.js';
import { AIWatchdog } from '../../domain/services/aiWatchdog.js';
import { OutputValidator } from '../../domain/services/outputValidator.js';
import { LocalGitSandbox } from '../../infrastructure/git/localGitSandbox.js';
import { SessionInfo, initSession, updateSession, readSession } from '../../cli/memory-manager.js';
import { loadConfig, resolveCli, buildCommandArgs } from '../../cli/cli-resolver.js';
import { spawnAgent, getAgentStatus, killAgent, checkTimeout, DEFAULT_SPAWN_CONFIG } from '../../cli/agent-spawner.js';

import { WorktreeManager } from '../environment/worktreeManager.js';
import { ReviewOrchestrator } from './reviewOrchestrator.js';
import { CliAgentRunner } from '../../cli/agent-runner-impl.js';
import { Instruction } from '../../domain/models/promptFacet.js';
import { Issue } from '../../domain/models/feedback.js';

/**
 * オーケストレーションのメインロジックを担当するサービス。
 * CLI から切り離され、テストや他のインターフェースから利用可能。
 */
export class OrchestrationService {
    private logger: (message: string, agent?: string, metadata?: any) => void;

    constructor(logger: (message: string, agent?: string, metadata?: any) => void) {
        this.logger = logger;
    }

    private log(message: string, agent: string = 'kanon', metadata: any = {}) {
        this.logger(message, agent, metadata);
    }

    /**
     * Score に基づいた自律実行。
     */
    public async runScore(_args: string[], resumeSession?: SessionInfo): Promise<void> {
        this.log(resumeSession ? `🔄 Resuming Score Execution: ${resumeSession.id}...` : '🎼 Starting Score Execution (Passage Flow)...', 'Conductor');

        const scorePath = path.join(process.cwd(), 'score.json');
        if (!fs.existsSync(scorePath)) {
            throw new Error('score.json not found in current directory.');
        }

        const score: Score = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
        const ruleEngine = new RuleEngine();
        const watchdog = new LoopWatchdog();
        const aiWatchdog = new AIWatchdog();
        const consensusService = new ConsensusService();
        const executor = new ScoreExecutor(score, ruleEngine, watchdog);

        const executionHistory: AgentOutput[] = [];
        const sandbox = new LocalGitSandbox(process.cwd());
        const worktreeOrchestrator = new WorktreeOrchestrator(sandbox);
        
        let worktreePath: string;
        if (resumeSession?.worktreePath && fs.existsSync(resumeSession.worktreePath)) {
            worktreePath = resumeSession.worktreePath;
            this.log(`🔄 Reusing existing worktree: ${worktreePath}`, 'Conductor');
        } else {
            this.log(`🏗️  Setting up automatic worktree for score: ${score.name}...`, 'Conductor');
            worktreePath = await worktreeOrchestrator.setup(score.name);
            this.log(`✅ Sandbox ready at: ${worktreePath}`, 'Conductor');
        }

        const sessionId = resumeSession?.id || `score-${Date.now()}`;

        if (resumeSession?.currentPassage) {
            this.log(`⏩ Skipping to passage: ${resumeSession.currentPassage}`, 'Conductor');
            executor.skipToPassage(resumeSession.currentPassage);
        }

        if (!resumeSession) {
            initSession(sessionId, process.cwd());
            updateSession('running', 'score', process.cwd(), 'score', score.name, executor.getCurrentPassage().name, worktreePath);
        }

        let isStalled = false;
        let isSuccess = false;
        try {
            while (true) {
                const passage = executor.getCurrentPassage();
                this.log(`🎵 Current Passage: ${passage.displayName} (${passage.name})`, 'Conductor');

                updateSession('running', 'score', process.cwd(), 'score', score.name, passage.name, worktreePath);

                let finalOutput = '';

                if (passage.skills && passage.skills.length > 0) {
                    const MAX_DELIBERATIONS = 2;
                    let deliberationContext: AgentOutput[] = [];

                    for (let round = 0; round <= MAX_DELIBERATIONS; round++) {
                        const parallelRunner = new ParallelRunner((skill) => {
                            const overridePrompt = deliberationContext.length > 0 
                                ? consensusService.buildDeliberationFeedback(skill, deliberationContext)
                                : undefined;
                            return this.runPassage(passage, sessionId, skill, overridePrompt, worktreePath);
                        });

                        const outputs = await parallelRunner.run(passage.skills);
                        deliberationContext = passage.skills.map((skill, i) => ({ skill, output: outputs[i] }));

                        this.log('⚖️ Deliberating consensus...', 'Conductor');
                        const supervisorPrompt = consensusService.buildSupervisorPrompt(deliberationContext);
                        
                        finalOutput = await this.runPassage({
                            name: 'supervisor_decision',
                            displayName: 'Decide next step based on consensus',
                            skill: 'reviewer'
                        }, sessionId, 'supervisor', supervisorPrompt, worktreePath);

                        const nextPassageName = ruleEngine.determineNextPassage(finalOutput);
                        if (nextPassageName !== 'deliberate' || round === MAX_DELIBERATIONS) break;
                    }
                } else {
                    finalOutput = await this.runPassage(passage, sessionId, undefined, undefined, worktreePath);
                }
                
                executionHistory.push({ skill: passage.skills?.[0] || passage.skill, output: finalOutput });
                const { nextPassageName, stalled } = executor.processOutput(finalOutput);
                
                if (stalled && executionHistory.length >= 3) {
                    this.log('🧐 Simple stall detected. Invoking AI Watchdog...', 'Conductor');
                    const watchdogPrompt = aiWatchdog.buildWatchdogPrompt(executionHistory.slice(-5));
                    const watchdogOutput = await this.runPassage({
                        name: 'ai_watchdog_assessment',
                        displayName: 'Assess progress',
                        skill: 'reviewer'
                    }, sessionId, 'supervisor', watchdogPrompt, worktreePath);

                    const watchdogMatch = watchdogOutput.match(/```json:watchdog-result\s+([\s\S]*?)\s+```/);
                    if (watchdogMatch) {
                        const watchdogResult = JSON.parse(watchdogMatch[1]);
                        if (watchdogResult.isStalled) {
                            this.log(`🛑 AI Watchdog confirmed stall: ${watchdogResult.reason}`, 'error');
                            isStalled = true;
                            break;
                        }
                    } else {
                        isStalled = true;
                        break;
                    }
                } else if (stalled) {
                    isStalled = true;
                    break;
                }

                if (!nextPassageName) {
                    this.log('🏁 No more passages. Score completed successfully.', 'Conductor');
                    isSuccess = true;
                    break;
                }
                this.log(`➡️ Transitioning to: ${nextPassageName}`, 'Conductor');
            }
        } catch (error) {
            this.log(`❌ Error during score execution: ${error}`, 'error');
            throw error;
        } finally {
            if (isSuccess || isStalled) {
                this.log(`🧹 Finalizing worktree (Success: ${isSuccess})...`, 'Conductor');
                await worktreeOrchestrator.finalize(worktreePath, isSuccess);
                this.log('✨ Cleaned up and merged back to main.', 'Conductor');
                updateSession(isSuccess ? 'completed' : 'failed', isSuccess ? 'done' : 'stalled', process.cwd());
            } else {
                this.log(`⚠️ Preserving worktree due to interruption: ${worktreePath}`, 'warning');
                updateSession('failed', 'interrupted', process.cwd(), 'score', score.name, executor.getCurrentPassage().name, worktreePath);
            }
        }

        if (isStalled) throw new Error('Score execution stalled.');
    }

    /**
     * 単一の Passage を実行し、バリデーションとリトライを行う。
     */
    public async runPassage(passage: Passage, sessionId: string, overrideSkill?: string, overridePrompt?: string, worktreePath?: string): Promise<string> {
        const workspace = worktreePath || process.cwd();
        const config = loadConfig(path.join(workspace, '.kanon', 'config.json'));
        const spawnConfig = {
            ...DEFAULT_SPAWN_CONFIG,
            idleTimeoutMs: config.idleTimeoutMs || DEFAULT_SPAWN_CONFIG.idleTimeoutMs
        };
        const targetSkill = overrideSkill || passage.skill;
        const { cliName, definition } = resolveCli(targetSkill, config);
        const model = config.agents[targetSkill]?.model_primary;
        
        const assembler = new PromptAssembler(path.join(process.cwd(), 'facets'));
        const validator = new OutputValidator();
        const MAX_RETRIES = 3;
        let currentFeedback: string | undefined = undefined;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const blueprint = {
                persona: passage.persona,
                policies: passage.policies,
                knowledge: passage.knowledge,
                instruction: (currentFeedback ? `${currentFeedback}\n\n` : '') + (overridePrompt || `
# Objective
${passage.displayName}
# Context
- Current Passage: ${passage.name}
# Output Requirement
Output your next step in \`\`\`json:passage-result\`\`\` format.
`)
            };

            const prompt = await assembler.assemble(blueprint);
            const command = buildCommandArgs(definition, prompt, { autoApprove: true, outputFormat: true, model });

            this.log(`Executing ${targetSkill} (Attempt ${attempt}/${MAX_RETRIES})...`, 'Conductor');

            const result = await new Promise<string>((resolve, reject) => {
                spawnAgent(targetSkill, command, sessionId, cliName, workspace, (data) => {
                    this.log(data, targetSkill);
                });

                const poll = setInterval(() => {
                    const status = getAgentStatus(sessionId, targetSkill);
                    if (!status) return;
                    const timeoutStatus = checkTimeout(status, spawnConfig);
                    if (timeoutStatus !== 'none') {
                        killAgent(sessionId, targetSkill);
                        clearInterval(poll);
                        reject(new Error(`${targetSkill} timed out`));
                        return;
                    }
                    if (status.status !== 'running') {
                        clearInterval(poll);
                        if (status.exitCode === 0) resolve(status.stdout || '');
                        else reject(new Error(`${targetSkill} failed`));
                    }
                }, 1000);
            });

            const validation = validator.validate(result, passage.outputContract || { format: 'json' });
            if (validation.isValid) {
                let content = result;
                try {
                    const parsed = JSON.parse(result);
                    if (parsed && parsed.response) content = parsed.response;
                } catch (e) {}
                return content;
            } else {
                currentFeedback = `\n\n⚠️ Invalid output. Errors:\n- ${validation.errors.join('\n- ')}\nCorrect your format.`;
                if (attempt === MAX_RETRIES) throw new Error(`${targetSkill} invalid output after retries.`);
            }
        }
        throw new Error('Unreachable');
    }

    /**
     * フェーズベースの従来型実行 (runExecute)。
     */
    public async runExecute(taskName: string, taskForResume: string, sessionId: string): Promise<void> {
        this.log('Starting execution with Kanon Architecture (DDD/FSM)', 'Conductor');

        const config = loadConfig();
        const sandbox = new LocalGitSandbox(process.cwd(), config.worktreeDir || 'worktree');
        const worktreeMgr = new WorktreeManager(sandbox);
        const runner = new CliAgentRunner();
        const orchestrator = new ReviewOrchestrator(
            sessionId,
            ['reviewer', 'creator', 'tester'],
            runner,
            (status, metadata) => this.log(status, 'Conductor', metadata)
        );

        const planPath = path.join(process.cwd(), 'implementation_plan.md');
        let planContent = 'No plan found.';
        if (fs.existsSync(planPath)) {
            planContent = fs.readFileSync(planPath, 'utf-8');
        }

        const targetDir = await worktreeMgr.setupTaskEnvironment(taskName, 'main');
        this.log(`Isolated environment created at: ${targetDir}`, 'Conductor');

        const instruction: Instruction = {
            objective: 'Implement the task according to the plan.',
            tasks: ['Read plan.', 'Write code.', 'Ensure tests pass.', `Plan:\n${planContent}`]
        };

        try {
            const success = await orchestrator.runCorrectionLoop(
                'developer',
                targetDir,
                instruction,
                { type: 'all', targetAgents: ['reviewer-1'] },
                3,
                async (wtPath: string) => {
                    const result = await this.validateCode(wtPath);
                    if (!result.passed) {
                        return [{ level: 'error', description: 'Validation failed.', suggestedFix: result.error }] as Issue[];
                    }
                    return [];
                },
                () => null // TODO: Intervention
            );

            if (success) {
                this.log('Execution completed! Merging...', 'Conductor');
                await worktreeMgr.saveAndCleanup(targetDir, `feat: Implement task ${taskName}`);
                updateSession('completed', 'execute', process.cwd(), 'execute', taskForResume);
            } else {
                await worktreeMgr.abortAndCleanup(targetDir);
                updateSession('failed', 'execute', process.cwd(), 'execute', taskForResume);
                throw new Error('Task implementation failed validation.');
            }
        } catch (error) {
            this.log(`⚠️ Orchestration Interrupted: ${error}`, 'warning');
            updateSession('failed', 'execute', process.cwd(), 'execute', taskForResume);
            throw error;
        }
    }

    private async validateCode(cwd: string): Promise<{ passed: boolean; error?: string }> {
        this.log('Running Dynamic Validation...', 'Conductor');
        const files = await this.listProjectFiles(cwd);
        
        // 簡易バリデーション (実際はもっと複雑だが、ここではエッセンスのみ)
        return this.runStaticAnalysis(cwd);
    }

    private async listProjectFiles(cwd: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync('git ls-files', { cwd });
            return stdout.split('\n').filter(f => f.length > 0);
        } catch (e) {
            return fs.readdirSync(cwd);
        }
    }

    private async runStaticAnalysis(cwd: string): Promise<{ passed: boolean; error?: string }> {
        this.log('Running Static Analysis...', 'Conductor');
        if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
            try {
                await execAsync('npx tsc --noEmit', { cwd });
                return { passed: true };
            } catch (error: any) {
                return { passed: false, error: error.stdout || error.message };
            }
        }
        return { passed: true };
    }
}
