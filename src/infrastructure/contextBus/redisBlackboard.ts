import { createClient, RedisClientType } from 'redis';
import { BlackboardRepository, ContextData } from '../../domain/repositories/blackboard.js';
import { AgentId } from '../../domain/models/agentState.js';

export class RedisBlackboard implements BlackboardRepository {
    private client: RedisClientType;
    private subscriberClient: RedisClientType;
    private isConnected: boolean = false;
    private readonly HASH_KEY = 'kanon:blackboard:topics';
    private readonly CHANNEL_PREFIX = 'kanon:blackboard:pubsub:';

    constructor(redisUrl: string = 'redis://localhost:6379') {
        this.client = createClient({ url: redisUrl });
        this.subscriberClient = createClient({ url: redisUrl });
        
        this.client.on('error', (err) => console.error('Redis Client Error', err));
        this.subscriberClient.on('error', (err) => console.error('Redis Subscriber Client Error', err));
    }

    public async connect(): Promise<void> {
        if (!this.isConnected) {
            await Promise.all([
                this.client.connect(),
                this.subscriberClient.connect()
            ]);
            this.isConnected = true;
        }
    }

    public async disconnect(): Promise<void> {
        if (this.isConnected) {
            await Promise.all([
                this.client.disconnect(),
                this.subscriberClient.disconnect()
            ]);
            this.isConnected = false;
        }
    }

    /**
     * 新しいナレッジを黒板に公開するか、既存のトピックを更新します。
     */
    public async publishKnowledge(author: AgentId, topic: string, content: any): Promise<number> {
        await this.connect();

        const existingStr = await this.client.hGet(this.HASH_KEY, topic);
        const existing = existingStr ? JSON.parse(existingStr) as ContextData : null;
        const nextVersion = existing ? existing.version + 1 : 1;

        const newData: ContextData = {
            topic,
            content,
            version: nextVersion,
            timestamp: new Date(),
            author
        };

        const serialized = JSON.stringify(newData);
        await this.client.hSet(this.HASH_KEY, topic, serialized);
        
        // Publish to channel for subscribers
        await this.client.publish(`${this.CHANNEL_PREFIX}${topic}`, serialized);

        return nextVersion;
    }

    /**
     * 特定のトピックに関する最新のナレッジを読み取ります。
     */
    public async readKnowledge(topic: string): Promise<ContextData | null> {
        await this.connect();
        const dataStr = await this.client.hGet(this.HASH_KEY, topic);
        if (!dataStr) return null;

        const data = JSON.parse(dataStr) as ContextData;
        // JSON.parse converts Date to string, so we need to convert it back
        data.timestamp = new Date(data.timestamp);
        return data;
    }

    /**
     * 特定のトピックへの更新を購読します。
     */
    public async subscribeKnowledge(_subjectAgent: AgentId, topic: string, callback: (data: ContextData) => void): Promise<void> {
        await this.connect();
        await this.subscriberClient.subscribe(`${this.CHANNEL_PREFIX}${topic}`, (message) => {
            const data = JSON.parse(message) as ContextData;
            data.timestamp = new Date(data.timestamp);
            callback(data);
        });
    }

    /**
     * 黒板上の全てのトピック名を取得します。
     */
    public async getAllTopics(): Promise<string[]> {
        await this.connect();
        return await this.client.hKeys(this.HASH_KEY);
    }
}
