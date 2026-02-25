import { AgentId } from '../models/agentState.js';

export interface ContextData {
    topic: string;
    content: any;
    version: number;
    timestamp: Date;
    author: AgentId;
}

export interface BlackboardRepository {
    /**
     * 共有黒板上で新しいナレッジを公開するか、既存のトピックを更新します。
     * 新しいバージョンの番号を返します。
     */
    publishKnowledge(author: AgentId, topic: string, content: any): Promise<number>;

    /**
     * 特定のトピックについて最新のナレッジを読み取ります。
     */
    readKnowledge(topic: string): Promise<ContextData | null>;

    /**
     * 特定のトピックにおける更新を購読します。
     * 備考: 純粋なDDDではイベントリスナーがドメインイベント経由で発行される場合がありますが、
     * リポジトリのサブスクリプションはリアルタイム・コラボレーションエージェントに適しています。
     */
    subscribeKnowledge(subjectAgent: AgentId, topic: string, callback: (data: ContextData) => void): Promise<void>;

    /**
     * 現在利用可能なすべてのトピックを取得します。
     */
    getAllTopics(): Promise<string[]>;
}
