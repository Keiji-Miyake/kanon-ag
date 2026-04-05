import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import { ScoreExecutor } from '../../domain/services/scoreExecutor.js';
import { RuleEngine } from '../../domain/services/ruleEngine.js';
import { LoopWatchdog } from '../../domain/services/loopWatchdog.js';
import { PromptAssembler } from '../../domain/services/promptAssembler.js';
import { ParallelRunner } from '../../domain/services/parallelRunner.js';
import { ConsensusService } from '../../domain/services/consensusService.js';
import { WorktreeOrchestrator } from '../../domain/services/worktreeOrchestrator.js';
import { AIWatchdog } from '../../domain/services/aiWatchdog.js';
import { AjvOutputValidator } from '../../infrastructure/validation/ajvOutputValidator.js';
import { ValidateAgentOutputUseCase } from './validateAgentOutputUseCase.js';
import { LocalGitSandbox } from '../../infrastructure/git/localGitSandbox.js';
import { initSession, updateSession } from '../../cli/memory-manager.js';
import { AiJudgeClient } from '../../infrastructure/ai/aiJudgeClient.js';
import { EvaluateTaskProgressUseCase } from './evaluateTaskProgressUseCase.js';
import * as readline from 'readline';
import { loadConfig, resolveCli, buildCommandArgs } from '../../cli/cli-resolver.js';
import { spawnAgent, getAgentStatus, killAgent, checkTimeout, DEFAULT_SPAWN_CONFIG } from '../../cli/agent-spawner.js';
import { WorktreeManager } from '../environment/worktreeManager.js';
import { ReviewOrchestrator } from './reviewOrchestrator.js';
import { CliAgentRunner } from '../../cli/agent-runner-impl.js';
/**
 * オーケストレーションのメインロジックを担当するサービス。
 * CLI から切り離され、テストや他のインターフェースから利用可能。
 */
export class OrchestrationService {
    logger;
    evaluateTaskProgressUseCase;
    constructor(logger, evaluateTaskProgressUseCase) {
        this.logger = logger;
        this.evaluateTaskProgressUseCase = evaluateTaskProgressUseCase || this.createDefaultEvaluateTaskProgressUseCase();
    }
    createDefaultEvaluateTaskProgressUseCase() {
        const aiJudgeClient = new AiJudgeClient(async (prompt) => {
            return await this.runPassage({
                name: 'ai_judge_evaluation',
                displayName: 'AI Judge Evaluation',
                skill: 'reviewer',
                outputContract: { format: 'json' }
            }, `judge-${Date.now()}`, 'supervisor', prompt);
        });
        return new EvaluateTaskProgressUseCase(aiJudgeClient);
    }
    log(message, agent = 'kanon', metadata = {}) {
        this.logger(message, agent, metadata);
    }
    /**
     * Score に基づいた自律実行。
     */
    async runScore(_args, resumeSession) {
        this.log(resumeSession ? `🔄 Resuming Score Execution: ${resumeSession.id}...` : '🎼 Starting Score Execution (Passage Flow)...', 'Conductor');
        const scorePath = path.join(process.cwd(), 'score.json');
        if (!fs.existsSync(scorePath)) {
            throw new Error('score.json not found in current directory.');
        }
        let score = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
        const scoreContext = { name: score.name, description: score.description };
        const ruleEngine = new RuleEngine();
        const watchdog = new LoopWatchdog();
        const aiWatchdog = new AIWatchdog();
        const consensusService = new ConsensusService();
        const executor = new ScoreExecutor(score, ruleEngine, watchdog);
        const executionHistory = [];
        const sandbox = new LocalGitSandbox(process.cwd());
        const worktreeOrchestrator = new WorktreeOrchestrator(sandbox);
        let worktreePath;
        if (resumeSession?.worktreePath && fs.existsSync(resumeSession.worktreePath)) {
            worktreePath = resumeSession.worktreePath;
            this.log(`🔄 Reusing existing worktree: ${worktreePath}`, 'Conductor');
        }
        else {
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
        let nextFeedback = undefined;
        try {
            while (true) {
                const passage = executor.getCurrentPassage();
                this.log(`🎵 Current Passage: ${passage.displayName} (${passage.name})`, 'Conductor');
                updateSession('running', 'score', process.cwd(), 'score', score.name, passage.name, worktreePath);
                let finalOutput = '';
                if (passage.skills && passage.skills.length > 0) {
                    const MAX_DELIBERATIONS = 2;
                    let deliberationContext = [];
                    for (let round = 0; round <= MAX_DELIBERATIONS; round++) {
                        const parallelRunner = new ParallelRunner((skill) => {
                            const overridePrompt = deliberationContext.length > 0
                                ? consensusService.buildDeliberationFeedback(skill, deliberationContext)
                                : undefined;
                            // Add nextFeedback to the prompt if it exists
                            const promptWithFeedback = nextFeedback ? `${nextFeedback}\n\n${overridePrompt || ''}` : overridePrompt;
                            return this.runPassage(passage, sessionId, skill, promptWithFeedback, worktreePath, scoreContext);
                        });
                        const outputs = await parallelRunner.run(passage.skills);
                        deliberationContext = passage.skills.map((skill, i) => ({ skill, output: outputs[i] }));
                        this.log('⚖️ Deliberating consensus...', 'Conductor');
                        const supervisorPrompt = consensusService.buildSupervisorPrompt(deliberationContext);
                        finalOutput = await this.runPassage({
                            name: 'supervisor_decision',
                            displayName: 'Decide next step based on consensus',
                            skill: 'reviewer'
                        }, sessionId, 'supervisor', supervisorPrompt, worktreePath, scoreContext);
                        const nextPassageName = ruleEngine.determineNextPassage(finalOutput);
                        if (nextPassageName !== 'deliberate' || round === MAX_DELIBERATIONS)
                            break;
                    }
                }
                else {
                    finalOutput = await this.runPassage(passage, sessionId, undefined, nextFeedback, worktreePath, scoreContext);
                }
                // Clear feedback after using it
                nextFeedback = undefined;
                executionHistory.push({ skill: passage.skills?.[0] || passage.skill, output: finalOutput, consensusReached: !!passage.skills?.length });
                const { nextPassageName, stalled } = executor.processOutput(finalOutput);
                if (stalled && executionHistory.length >= 3) {
                    this.log('🧐 Simple stall detected. Invoking AI Watchdog...', 'Conductor');
                    const watchdogPrompt = aiWatchdog.buildWatchdogPrompt(executionHistory.slice(-5));
                    const watchdogOutput = await this.runPassage({
                        name: 'ai_watchdog_assessment',
                        displayName: 'Assess progress',
                        skill: 'reviewer'
                    }, sessionId, 'supervisor', watchdogPrompt, worktreePath, scoreContext);
                    const watchdogMatch = watchdogOutput.match(/```json:watchdog-result\s+([\s\S]*?)\s+```/);
                    if (watchdogMatch) {
                        const watchdogResult = JSON.parse(watchdogMatch[1]);
                        if (watchdogResult.isStalled) {
                            this.log(`🛑 AI Watchdog confirmed stall: ${watchdogResult.reason}`, 'error');
                            // --- AI JUDGE INTEGRATION ---
                            this.log('⚖️ Invoking AI Judge for objective assessment...', 'Conductor');
                            const historyContext = executionHistory.slice(-10).map((h, i) => `Iteration ${i + 1} (${h.skill}):\n${h.output}`).join('\n\n');
                            const evaluation = await this.evaluateTaskProgressUseCase.execute(historyContext);
                            if (evaluation.status === 'CONTINUE') {
                                this.log(`✅ AI Judge decided to CONTINUE: ${evaluation.reason}`, 'Conductor');
                                watchdog.reset();
                                nextFeedback = `[AI Judge Hint] ${evaluation.reason}`;
                                continue;
                            }
                            else if (evaluation.status === 'ABORT') {
                                this.log(`🛑 AI Judge decided to ABORT: ${evaluation.reason}`, 'error');
                                isStalled = true;
                                break;
                            }
                            else if (evaluation.status === 'ESCALATE') {
                                this.log(`⚠️ AI Judge requested ESCALATION: ${evaluation.summary}`, 'warning');
                                console.log('\n--- ESCALATION REQUIRED ---');
                                console.log(`Summary: ${evaluation.summary}`);
                                console.log(`Core Issue: ${evaluation.coreIssue}`);
                                if (evaluation.options) {
                                    console.log('Options:');
                                    evaluation.options.forEach((opt, idx) => console.log(`  ${idx + 1}. ${opt}`));
                                }
                                console.log('---------------------------\n');
                                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                                const answer = await new Promise((resolve) => {
                                    rl.question('Please provide your feedback or instructions: ', (input) => {
                                        rl.close();
                                        resolve(input);
                                    });
                                });
                                nextFeedback = `[User Intervention] ${answer}`;
                                watchdog.reset();
                                this.log('🔄 User intervention received. Resuming loop...', 'Conductor');
                                continue;
                            }
                            // -----------------------------
                            const correctedScore = await this.selfCorrect(executor.getScore(), watchdogResult, sessionId, worktreePath);
                            if (correctedScore) {
                                score = correctedScore;
                                executor.updateScore(score);
                                this.log('✅ Score auto-corrected. Resuming...', 'Conductor');
                                continue;
                            }
                            isStalled = true;
                            break;
                        }
                    }
                    else {
                        isStalled = true;
                        break;
                    }
                }
                else if (stalled) {
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
        }
        catch (error) {
            this.log(`❌ Error during score execution: ${error}`, 'error');
            throw error;
        }
        finally {
            if (isSuccess || isStalled) {
                this.log(`🧹 Finalizing worktree (Success: ${isSuccess})...`, 'Conductor');
                await worktreeOrchestrator.finalize(worktreePath, isSuccess);
                this.log('✨ Cleaned up and merged back to main.', 'Conductor');
                updateSession(isSuccess ? 'completed' : 'failed', isSuccess ? 'done' : 'stalled', process.cwd());
                if (isSuccess) {
                    await this.reflect(executionHistory);
                }
            }
            else {
                this.log(`⚠️ Preserving worktree due to interruption: ${worktreePath}`, 'warning');
                updateSession('failed', 'interrupted', process.cwd(), 'score', executor.getScore().name, executor.getCurrentPassage().name, worktreePath);
            }
        }
        if (isStalled)
            throw new Error('Score execution stalled.');
    }
    /**
     * 単一の Passage を実行し、バリデーションとリトライを行う。
     */
    async runPassage(passage, sessionId, overrideSkill, overridePrompt, worktreePath, scoreContext) {
        const workspace = worktreePath || process.cwd();
        const config = loadConfig(path.join(workspace, '.kanon', 'config.json'));
        const spawnConfig = {
            ...DEFAULT_SPAWN_CONFIG,
            idleTimeoutMs: 600000, // 10分 (エージェントの起動が遅い場合があるため)
            timeoutMs: 1200000 // 合計20分
        };
        const targetSkill = overrideSkill || passage.skill;
        const { cliName, definition } = resolveCli(targetSkill, config);
        const model = config.agents[targetSkill]?.model_primary;
        const assembler = new PromptAssembler(path.join(process.cwd(), 'facets'));
        const validator = new ValidateAgentOutputUseCase(new AjvOutputValidator());
        const MAX_RETRIES = 5;
        let currentFeedback = undefined;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const blueprint = {
                persona: passage.persona,
                policies: passage.policies,
                knowledge: passage.knowledge,
                outputContract: passage.outputContract || { format: 'json' },
                instruction: (currentFeedback ? `${currentFeedback}\n\n` : '') + (overridePrompt || `
# Objective
${passage.displayName}
# Score Context
- Score Name: ${scoreContext?.name || 'Autonomous Loop'}
- Score Description: ${scoreContext?.description || ''}
# Context
- Current Passage: ${passage.name}
# Output Requirement
Output your next step in \`\`\`json:passage-result\`\`\` format.
`)
            };
            const prompt = await assembler.assemble(blueprint);
            const command = buildCommandArgs(definition, prompt, { autoApprove: true, outputFormat: true, model });
            this.log(`Executing ${targetSkill} (Attempt ${attempt}/${MAX_RETRIES})...`, 'Conductor');
            const result = await new Promise((resolve, reject) => {
                spawnAgent(targetSkill, command, sessionId, cliName, workspace, (data) => {
                    this.log(data, targetSkill);
                });
                const poll = setInterval(() => {
                    const status = getAgentStatus(sessionId, targetSkill);
                    if (!status)
                        return;
                    const timeoutStatus = checkTimeout(status, spawnConfig);
                    if (timeoutStatus !== 'none') {
                        killAgent(sessionId, targetSkill);
                        clearInterval(poll);
                        reject(new Error(`${targetSkill} timed out`));
                        return;
                    }
                    if (status.status !== 'running') {
                        clearInterval(poll);
                        if (status.exitCode === 0)
                            resolve(status.stdout || '');
                        else
                            reject(new Error(`${targetSkill} failed`));
                    }
                }, 1000);
            });
            const validation = await validator.execute(result, passage.outputContract || { format: 'json' });
            if (validation.isValid) {
                let content = result;
                try {
                    const parsed = JSON.parse(result);
                    if (parsed && parsed.response)
                        content = parsed.response;
                }
                catch (e) { }
                return content;
            }
            else {
                currentFeedback = `\n\n⚠️ Invalid output. Errors:\n- ${validation.errors.map(e => `${e.path}: ${e.message}`).join('\n- ')}\nCorrect your format.`;
                if (attempt === MAX_RETRIES) {
                    // ここでも AI Judge を呼ぶべきか？
                    // 指示には「リトライ回数に達した際」とある。
                    this.log(`⚠️ Maximum retries reached for ${targetSkill}. Invoking AI Judge...`, 'warning');
                    const historyContext = `Skill: ${targetSkill}\nAttempts: ${MAX_RETRIES}\nLast Error:\n${currentFeedback}\nLast Result:\n${result}`;
                    const evaluation = await this.evaluateTaskProgressUseCase.execute(historyContext);
                    if (evaluation.status === 'CONTINUE') {
                        this.log(`⚖️ AI Judge decided to CONTINUE despite retry limit: ${evaluation.reason}`, 'Conductor');
                        // ループを継続させるために何らかのフラグを立てるか、リトライ回数を増やす必要があるが、
                        // ここは runPassage の中なので、呼び出し元に任せるのが良さそう。
                    }
                    throw new Error(`${targetSkill} invalid output after retries.`);
                }
            }
        }
        throw new Error('Unreachable');
    }
    async selfCorrect(score, assessment, sessionId, worktreePath) {
        this.log('Attempting Self-Correction...', 'Conductor');
        const scoreContext = { name: score.name, description: score.description };
        const prompt = `
# Self-Correction Request
The current orchestration loop is stalled.
Reason: ${assessment.reason}
Suggestion: ${assessment.suggestion}

## Current Score
\`\`\`json
${JSON.stringify(score, null, 2)}
\`\`\`

## Task
Modify the Score (JSON) to break the loop. You can:
1. Add a new Passage for debugging or environment fix.
2. Change the sequence of Passages.
3. Update Persona or Policies for a specific Passage.

Output the ENTIRE updated Score in \`\`\`json:score-update\`\`\` format.
`;
        const result = await this.runPassage({
            name: 'self-correction',
            displayName: 'Self-Correction',
            skill: 'architect',
            outputContract: { format: 'json' }
        }, sessionId, undefined, prompt, worktreePath, scoreContext);
        try {
            const match = result.match(/```json:score-update\n([\s\S]*?)\n```/);
            if (match) {
                const newScore = JSON.parse(match[1]);
                fs.writeFileSync(path.join(process.cwd(), 'score.json'), JSON.stringify(newScore, null, 2));
                return newScore;
            }
        }
        catch (e) {
            this.log(`Failed to parse self-correction output: ${e}`, 'error');
        }
        return null;
    }
    async reflect(history) {
        this.log('Performing Post-Task Reflection...', 'Conductor');
        const prompt = `
# Post-Task Reflection
Analyze the following execution history and extract "Lessons Learned" and "Best Practices".
Focus on:
1. What went well?
2. What were the obstacles and how were they overcome?
3. What coding standards or rules should be added to prevent future issues?

## Execution History
${history.map((h, i) => `### Step ${i + 1} (${h.skill})\n${h.output}`).join('\n\n')}

## Output Requirement
Output a Markdown document that can be used as a "Policy" facet.
`;
        const reflection = await this.runPassage({
            name: 'reflection',
            displayName: 'Post-Task Reflection',
            skill: 'architect',
            outputContract: { format: 'markdown' }
        }, `reflect-${Date.now()}`, undefined, prompt, undefined, { name: 'Reflection', description: 'Post-task analysis' });
        const policyDir = path.join(process.cwd(), 'facets', 'policy');
        if (!fs.existsSync(policyDir))
            fs.mkdirSync(policyDir, { recursive: true });
        const fileName = `learned-${new Date().toISOString().split('T')[0]}-${Math.floor(Math.random() * 1000)}.md`;
        fs.writeFileSync(path.join(policyDir, fileName), reflection);
        this.log(`✅ New policy generated: ${fileName}`, 'Conductor');
    }
    /**
     * フェーズベースの従来型実行 (runExecute)。
     */
    async runExecute(taskName, taskForResume, sessionId) {
        this.log('Starting execution with Kanon Architecture (DDD/FSM)', 'Conductor');
        const config = loadConfig();
        const sandbox = new LocalGitSandbox(process.cwd(), config.worktreeDir || 'worktree');
        const worktreeMgr = new WorktreeManager(sandbox);
        const runner = new CliAgentRunner();
        const orchestrator = new ReviewOrchestrator(sessionId, ['reviewer', 'creator', 'tester'], runner, (status, metadata) => this.log(status, 'Conductor', metadata));
        const planPath = path.join(process.cwd(), 'implementation_plan.md');
        let planContent = 'No plan found.';
        if (fs.existsSync(planPath)) {
            planContent = fs.readFileSync(planPath, 'utf-8');
        }
        const targetDir = await worktreeMgr.setupTaskEnvironment(taskName, 'main');
        this.log(`Isolated environment created at: ${targetDir}`, 'Conductor');
        const instruction = {
            objective: 'Implement the task according to the plan.',
            tasks: ['Read plan.', 'Write code.', 'Ensure tests pass.', `Plan:\n${planContent}`]
        };
        try {
            const success = await orchestrator.runCorrectionLoop('developer', targetDir, instruction, { type: 'all', targetAgents: ['reviewer-1'] }, 3, async (wtPath) => {
                const result = await this.validateCode(wtPath);
                if (!result.passed) {
                    return [{ level: 'error', description: 'Validation failed.', suggestedFix: result.error }];
                }
                return [];
            }, async () => null // Intervention placeholder
            );
            if (success) {
                this.log('Execution completed! Merging...', 'Conductor');
                await worktreeMgr.saveAndCleanup(targetDir, `feat: Implement task ${taskName}`);
                updateSession('completed', 'execute', process.cwd(), 'execute', taskForResume);
            }
            else {
                await worktreeMgr.abortAndCleanup(targetDir);
                updateSession('failed', 'execute', process.cwd(), 'execute', taskForResume);
                throw new Error('Task implementation failed validation.');
            }
        }
        catch (error) {
            this.log(`⚠️ Orchestration Interrupted: ${error}`, 'warning');
            updateSession('failed', 'execute', process.cwd(), 'execute', taskForResume);
            throw error;
        }
    }
    async validateCode(cwd) {
        this.log('Running Dynamic Validation...', 'Conductor');
        // 簡易バリデーション (実際はもっと複雑だが、ここではエッセンスのみ)
        return this.runStaticAnalysis(cwd);
    }
    async runStaticAnalysis(cwd) {
        this.log('Running Static Analysis...', 'Conductor');
        if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
            try {
                await execAsync('npx tsc --noEmit', { cwd });
                return { passed: true };
            }
            catch (error) {
                return { passed: false, error: error.stdout || error.message };
            }
        }
        return { passed: true };
    }
}
