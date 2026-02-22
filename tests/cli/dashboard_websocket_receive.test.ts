import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { DashboardInteraction } from '../../src/cli/dashboard.js';

describe('DashboardInteraction Receiving', () => {
    let wss: WebSocketServer;
    const WS_PORT = 3006;

    beforeEach(() => {
        wss = new WebSocketServer({ port: WS_PORT });
    });

    afterEach(() => {
        wss.close();
    });

    it('can receive message from server via handler', async () => {
        const interaction = new DashboardInteraction(`ws://localhost:${WS_PORT}`);
        
        let receivedMessage: any = null;
        const messagePromise = new Promise<void>((resolve) => {
            interaction.onMessage((msg) => {
                receivedMessage = msg;
                resolve();
            });
        });

        // サーバー側で接続を待ち受け、メッセージを送信するように設定
        const serverReady = new Promise<void>((resolve) => {
            wss.once('connection', (ws) => {
                ws.send(JSON.stringify({ type: 'thought', content: 'Thinking...' }));
                resolve();
            });
        });

        await interaction.connect();
        await serverReady;
        
        // メッセージ受信待ち
        await messagePromise;
        
        expect(receivedMessage).toEqual({
            type: 'thought',
            content: 'Thinking...'
        });

        interaction.disconnect();
    });
});
