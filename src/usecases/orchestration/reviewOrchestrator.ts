import { AgentId } from '../../domain/models/agentState.js';
import { ReviewFeedback, Issue } from '../../domain/models/feedback.js';
import { MergeGateway, AggregationResult } from '../../domain/services/mergeGateway.js';
import { AggregateCondition } from '../../domain/models/fsmNode.js';
import { Instruction } from '../../domain/models/promptFacet.js';
import { FeedbackInjector } from '../prompt/feedbackInjector.js';

export interface AgentRunner {
    runReview(agentId: AgentId, worktreePath: string, currentInstruction: Instruction): Promise<ReviewFeedback>;
    runImplementation(agentId: AgentId, worktreePath: string, instruction: Instruction): Promise<void>;
}

export class ReviewOrchestrator {
    private parallelReviewers: AgentId[];
    private agentRunner: AgentRunner;
    private onStatusUpdate?: (status: string, metadata?: any) => void;

    constructor(_sessionId: string, parallelReviewers: AgentId[], agentRunner: AgentRunner, onStatusUpdate?: (status: string, metadata?: any) => void) {
        this.parallelReviewers = parallelReviewers;
        this.agentRunner = agentRunner;
        this.onStatusUpdate = onStatusUpdate;
    }

    private emitStatus(message: string, metadata: any = {}): void {
        if (this.onStatusUpdate) {
            this.onStatusUpdate(message, { type: 'status', ...metadata });
        }
    }

    /**
     * 指定されたエージェント群を使って並行レビューを非同期に開始し、フィードバックを収集します。
     * @param worktreePath 対象となるワークツリー（サンドボックス）のパス
     * @param currentInstruction 現在の指示内容
     */
    public async startAsyncReviews(worktreePath: string, currentInstruction: Instruction): Promise<ReviewFeedback[]> {
        const reviewPromises = this.parallelReviewers.map(agentId =>
            this.agentRunner.runReview(agentId, worktreePath, currentInstruction)
        );

        // 全てのエージェントの処理完了を待機 (並行実行)
        return await Promise.all(reviewPromises);
    }

    /**
     * マージゲートウェイを用いて全てのフィードバックの集約判定を行います。
     */
    public evaluateFeedbacks(feedbacks: ReviewFeedback[], condition: AggregateCondition): AggregationResult {
        const gateway = new MergeGateway();
        return gateway.evaluate(condition, feedbacks);
    }

    /**
     * 自律デバッグループ：レビュー結果が棄却された場合、フィードバックを注入して再実装を試みます。
     */
    public async runCorrectionLoop(
        developerId: AgentId,
        worktreePath: string,
        initialInstruction: Instruction,
        condition: AggregateCondition,
        maxRetries: number = 3,
        gatekeeperFn?: (worktreePath: string) => Promise<Issue[]>
    ): Promise<boolean> {
        let currentInstruction = initialInstruction;
        let attempt = 0;
        const injector = new FeedbackInjector();

        while (attempt < maxRetries) {
            this.emitStatus(`Starting implementation attempt ${attempt + 1}/${maxRetries}`, { attempt: attempt + 1, maxRetries });
            // 1. 実装エージェントによるコード修正
            await this.agentRunner.runImplementation(developerId, worktreePath, currentInstruction);

            this.emitStatus(`Implementation complete. Starting parallel reviews...`, { attempt: attempt + 1 });
            // 2. 並行レビューの実行
            const feedbacks = await this.startAsyncReviews(worktreePath, currentInstruction);

            // 2.5. Gatekeeper (機械的検証) の実行
            if (gatekeeperFn) {
                this.emitStatus(`Running Gatekeeper (mechanical validation)...`, { attempt: attempt + 1 });
                const gatekeeperIssues = await gatekeeperFn(worktreePath);
                if (gatekeeperIssues.length > 0) {
                    this.emitStatus(`Gatekeeper found ${gatekeeperIssues.length} issues.`, { attempt: attempt + 1, issues: gatekeeperIssues });
                    feedbacks.push({
                        reviewerId: 'gatekeeper',
                        targetAgentId: developerId,
                        taskId: 'current',
                        status: 'rejected',
                        issues: gatekeeperIssues
                    });
                } else {
                    this.emitStatus(`Gatekeeper passed.`, { attempt: attempt + 1 });
                }
            }

            // 3. ゲートウェイ判定
            const result = this.evaluateFeedbacks(feedbacks, condition);
            this.emitStatus(`Review aggregation complete. Status: ${result.isApproved ? 'APPROVED' : 'REJECTED'}`, { 
                attempt: attempt + 1, 
                isApproved: result.isApproved,
                issueCount: result.mergedIssues.length 
            });

            if (result.isApproved) {
                return true; // ループ完了（承認）
            }

            // 4. 差し戻し時のInstruction合成（フィードバックの注入）
            currentInstruction = injector.injectIssues(currentInstruction, result.mergedIssues);

            attempt++;
        }

        return false; // 最大リトライ回数到達（失敗）
    }
}
