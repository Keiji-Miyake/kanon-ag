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
        const agentConfig = config.agents[skillName] || config.agents['architect']; // fallback to architect config if missing

        // 1. 実行設定のリストを作成
        const executionPlans: Array<{ cli: string; model: string | undefined; label: string }> = [
            { cli: agentConfig.cli, model: agentConfig.model_primary, label: 'Primary' },
        ];

        if (agentConfig.model_backup) {
            executionPlans.push({ cli: agentConfig.cli, model: agentConfig.model_backup, label: 'Model Fallback' });
        }

        if (agentConfig.model_backups && Array.isArray(agentConfig.model_backups)) {
            for (const backupModel of agentConfig.model_backups) {
                // 重複を避ける
                if (backupModel !== agentConfig.model_primary && backupModel !== agentConfig.model_backup) {
                    executionPlans.push({ cli: agentConfig.cli, model: backupModel, label: 'Model Chain Fallback' });
                }
            }
        }

        if (agentConfig.cli_backup) {
            executionPlans.push({ cli: agentConfig.cli_backup, model: (agentConfig as any).cli_backup_model || undefined, label: 'CLI Fallback' });
        } else if (agentConfig.cli !== 'gemini') {
            executionPlans.push({ cli: 'gemini', model: 'gemini-3-flash-preview', label: 'Emergency Fallback' });
        }

        let lastError: Error | null = null;

        for (const plan of executionPlans) {
            const sessionId = `${skillName}-session-${Date.now()}`;
            try {
                if (plan.label !== 'Primary') {
                    Logger.log(`⚠️ Primary failed. Retrying with ${plan.label}: ${plan.cli} (${plan.model || 'default'})`, 'System');
                }

                const cliDef = resolveCli(skillName, config, plan.cli).definition;
                const commandConfig = buildCommandArgs(cliDef, promptText, {
                    autoApprove: true,
                    model: plan.model,
                    skipPrompt: false // プロンプトを引数として渡す（互換性重視）
                });

                let logCommand = '';
                if (typeof commandConfig === 'string') {
                    logCommand = (commandConfig as string).substring(0, 100);
                } else {
                    const args = (commandConfig as any).args as string[];
                    logCommand = `${(commandConfig as any).cmd} ${args.filter(a => a !== promptText).join(' ')}`;
                }

                Logger.log(`Executing ${plan.label} command: ${logCommand}...`, 'System');

                let isLimitExceeded = false;
                const agentProcess = spawnAgent(skillName, commandConfig, sessionId, plan.cli, worktreePath, (data, _isErr) => {
                    if (data.trim() !== '') {
                        Logger.log(data.trim(), skillName);
                        if (data.includes('Usage limit') || data.includes('credit exhausted') || data.includes('Rate limit')) {
                            isLimitExceeded = true;
                        }
                    }
                }); // stdin 経由での送信を廃止

                // タイムアウトと終了を待機
                const timeoutMs = 900000; // 15分（複雑なプロジェクト生成対応）
                const result = await Promise.race([
                    agentProcess.promise,
                    new Promise<string>((_, reject) => {
                        const check = setInterval(() => {
                            if (isLimitExceeded) {
                                clearInterval(check);
                                reject(new Error('USAGE_LIMIT'));
                            }
                        }, 1000);
                        setTimeout(() => {
                            clearInterval(check);
                            reject(new Error('TIMEOUT'));
                        }, timeoutMs);
                    })
                ]);

                if (result === 'TIMEOUT' || result === 'USAGE_LIMIT') {
                    throw new Error(result);
                }

                const exitCode = result as unknown as number | null;
                const finalStatus = getAgentStatus(sessionId, skillName);

                if (exitCode === 0) {
                    return finalStatus?.stdout || '';
                }

                const errorMsg = finalStatus?.stderr || 'Unknown error';
                Logger.log(`[Attempt Failed] Execution for ${plan.label} (${plan.cli}, ${plan.model || 'default'}) failed with code ${exitCode}. Error: ${errorMsg}`, 'error');
                throw new Error(`Execution failed (code ${exitCode}). ${errorMsg}`);

            } catch (e: any) {
                lastError = e;
                const msg = e.message === 'TIMEOUT' ? 'Execution Timed Out' : (e.message === 'USAGE_LIMIT' ? 'Usage Limit Exceeded' : e.message);
                Logger.log(`❌ ${plan.label} attempt failed: ${msg}`, 'System');

                // 失敗したエージェントプロセスを即座にクリーンアップ
                try {
                    const { cleanupSession } = await import('./agent-spawner.js');
                    cleanupSession(sessionId);
                } catch (err) { }
            }
        }

        Logger.log(`[Final Fallback] All ${executionPlans.length} attempts failed for skill: ${skillName}`, 'error');
        throw lastError || new Error(`Agent ${agentId} (${skillName}) failed all ${executionPlans.length} execution attempts.`);
    }
}
