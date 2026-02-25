import { ReviewFeedback, Issue } from '../models/feedback.js';
import { AggregateCondition } from '../models/fsmNode.js';

export interface AggregationResult {
    isResolved: boolean;     // ゲートウェイの条件が満たされ、処理を続行できる場合はTrue
    isApproved: boolean;     // 肯定的な/承認された状態で条件が満たされた場合はTrue
    pendingAgents: string[];   // まだ応答していないエージェント
    mergedIssues: Issue[];
}

export class MergeGateway {
    /**
     * 収集したフィードバックを、定義された集約条件に照らし合わせて評価します。
     */
    public evaluate(
        condition: AggregateCondition,
        feedbacks: ReviewFeedback[]
    ): AggregationResult {
        const receivedAgentIds = feedbacks.map(f => f.reviewerId);
        const pendingAgents = condition.targetAgents.filter((a: string) => !receivedAgentIds.includes(a));

        const allIssues = feedbacks.flatMap(f => f.issues || []);

        switch (condition.type) {
            case 'all': {
                // ALL条件: 全員が応答し、かつ全員が承認(approve)しなければならない。
                const hasAllResponded = pendingAgents.length === 0;
                if (!hasAllResponded) {
                    return { isResolved: false, isApproved: false, pendingAgents, mergedIssues: allIssues };
                }

                const isAllApproved = feedbacks.every(f => f.status === 'approved');
                return {
                    isResolved: true,
                    isApproved: isAllApproved,
                    pendingAgents: [],
                    mergedIssues: allIssues
                };
            }
            case 'any': {
                // ANY条件: 誰か一人でも承認すれば、全体として承認されたと見なす。
                const hasAnyApproved = feedbacks.some(f => f.status === 'approved');
                if (hasAnyApproved) {
                    return {
                        isResolved: true,
                        isApproved: true,
                        pendingAgents: pendingAgents,
                        mergedIssues: allIssues
                    };
                }

                const hasAllResponded = pendingAgents.length === 0;
                if (hasAllResponded) {
                    // 全員が応答したが、誰も承認しなかった場合
                    return {
                        isResolved: true,
                        isApproved: false,
                        pendingAgents: [],
                        mergedIssues: allIssues
                    };
                }

                // 他のエージェントの応答を待つ
                return { isResolved: false, isApproved: false, pendingAgents, mergedIssues: allIssues };
            }
            default:
                throw new Error(`Unknown aggregate condition type: ${(condition as any).type}`);
        }
    }
}
