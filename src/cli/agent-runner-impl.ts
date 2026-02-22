import { AgentId } from '../domain/models/agentState.js';
import { ReviewFeedback, Issue } from '../domain/models/feedback.js';
import { Instruction, FacetedPrompt } from '../domain/models/promptFacet.js';
import { AgentRunner } from '../usecases/orchestration/reviewOrchestrator.js';
import { PromptSynthesizer } from '../usecases/prompt/synthesizer.js';
import { loadConfig, resolveCli, buildCommandArgs } from './cli-resolver.js';
import { spawnAgent, getAgentStatus } from './agent-spawner.js';
import { Logger } from './orchestrate.js';

export class CliAgentRunner implements AgentRunner {
    private synthesizer: PromptSynthesizer;

    constructor() {
        this.synthesizer = new PromptSynthesizer();
    }

    public async runImplementation(agentId: AgentId, worktreePath: string, instruction: Instruction): Promise<void> {
        const promptString = this.preparePromptString(agentId, instruction, 'implement');

        await this.executeAgentProcess(agentId, 'developer', promptString, worktreePath);
    }

    public async runReview(agentId: AgentId, worktreePath: string, currentInstruction: Instruction): Promise<ReviewFeedback> {
        const promptString = this.preparePromptString(agentId, currentInstruction, 'review');

        const stdout = await this.executeAgentProcess(agentId, 'reviewer', promptString, worktreePath);

        // シンプルなパース（実装は実モデルにあわせて強化可能）
        let status: 'approved' | 'rejected' | 'needs_work' = 'approved';
        const issues: Issue[] = [];

        if (stdout.includes('[REJECT]') || stdout.includes('needs_work') || stdout.includes('Issues Found')) {
            status = 'rejected';
            issues.push({
                level: 'error',
                description: 'Issues found during automated review.',
                suggestedFix: stdout.substring(0, 500) // コンテキストを含める
            });
        }

        return {
            reviewerId: agentId,
            targetAgentId: 'developer', // デフォルト
            taskId: 'current',
            status,
            issues
        };
    }

    private preparePromptString(_agentId: AgentId, instruction: Instruction, mode: 'implement' | 'review'): string {
        const facet: FacetedPrompt = {
            persona: {
                role: mode === 'implement' ? 'Expert Developer' : 'Strict Reviewer',
                description: `You are an AI assistant tasked with ${mode}ing code.`,
                expertise: ['TypeScript', 'Node.js']
            },
            knowledge: {
                context: 'You are working in a Kanon FSM-orchestrated environment.'
            },
            instruction: instruction,
            outputContract: {
                format: mode === 'implement' ? 'text' : 'markdown',
            },
            policy: {
                rules: ['Do not execute destructive commands unless specified.'],
                constraints: [],
                qualityCriteria: [
                    'Ensure zero typed errors.',
                    'Global initializations must be placed at the very top of the entry point file.',
                    'Ensure comprehensive setup of testing ecosystem (tools, configs, mocks, task scripts).',
                ]
            }
        };

        return this.synthesizer.synthesize(facet);
    }

    private async executeAgentProcess(agentId: AgentId, skillName: string, promptText: string, worktreePath: string): Promise<string> {
        const config = loadConfig();
        // Fallback to gemini if cli definition misses
        let cliDef;
        try {
            cliDef = resolveCli(skillName, config);
        } catch {
            cliDef = resolveCli('architect', config); // fallback
        }

        const { cliName, definition } = cliDef;
        const model = config.agentModels?.[skillName];
        const commandConfig = buildCommandArgs(definition, promptText, { autoApprove: true, model });
        const sessionId = `${skillName}-session-${Date.now()}`;

        const agentProcess = spawnAgent(skillName, commandConfig, sessionId, cliName, worktreePath, (data, _isErr) => {
            if (data.trim() !== '') {
                // geminiからの標準エラー（_isErr=true）も、実際にはYoloモードの通知などがあるので通常ログ(skillName)として流す
                Logger.log(data.trim(), skillName);
            }
        });

        const exitCode = await agentProcess.promise;

        const finalStatus = getAgentStatus(sessionId, skillName);

        if (exitCode !== 0) {
            throw new Error(`Agent ${agentId} (${skillName}) exited with code ${exitCode}. Error: ${finalStatus?.stderr}`);
        }

        return finalStatus?.stdout || '';
    }
}
