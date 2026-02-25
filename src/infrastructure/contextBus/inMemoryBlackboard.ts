import { BlackboardRepository, ContextData } from '../../domain/repositories/blackboard.js';
import { AgentId } from '../../domain/models/agentState.js';

export class InMemoryBlackboard implements BlackboardRepository {
    private topics: Map<string, ContextData> = new Map();
    private subscribers: Map<string, Array<(data: ContextData) => void>> = new Map();

    /**
     * 新しいナレッジを黒板に公開するか、既存のトピックを更新します。
     * @returns 新しいバージョンの番号を返します。
     */
    public async publishKnowledge(author: AgentId, topic: string, content: any): Promise<number> {
        const existing = this.topics.get(topic);
        const nextVersion = existing ? existing.version + 1 : 1;

        const newData: ContextData = {
            topic,
            content,
            version: nextVersion,
            timestamp: new Date(),
            author
        };

        this.topics.set(topic, newData);
        this.notifySubscribers(topic, newData);

        return nextVersion;
    }

    /**
     * 特定のトピックに関する最新のナレッジを読み取ります。
     */
    public async readKnowledge(topic: string): Promise<ContextData | null> {
        return this.topics.get(topic) || null;
    }

    /**
     * 特定のトピックへの更新を購読します。
     */
    public async subscribeKnowledge(_subjectAgent: AgentId, topic: string, callback: (data: ContextData) => void): Promise<void> {
        const topicSubscribers = this.subscribers.get(topic) || [];
        topicSubscribers.push(callback);
        this.subscribers.set(topic, topicSubscribers);
    }

    /**
     * 黒板上の全てのトピック名を取得します。
     */
    public async getAllTopics(): Promise<string[]> {
        return Array.from(this.topics.keys());
    }

    /**
     * 購読者へ更新を通知するための内部メソッド。
     */
    private notifySubscribers(topic: string, data: ContextData): void {
        const topicSubscribers = this.subscribers.get(topic) || [];
        for (const callback of topicSubscribers) {
            try {
                callback(data);
            } catch (e) {
                console.error(`Error notifying subscriber for topic ${topic}:`, e);
            }
        }
    }
}
