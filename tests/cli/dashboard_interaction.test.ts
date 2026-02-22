import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { DashboardInteraction } from '../../src/cli/dashboard.js';

describe('DashboardInteraction', () => {
    let wss: WebSocketServer;
    const WS_PORT = 3005;

    beforeEach(() => {
        wss = new WebSocketServer({ port: WS_PORT });
    });

    afterEach(() => {
        wss.close();
    });

    it('can connect to WebSocket server', async () => {
        const interaction = new DashboardInteraction(`ws://localhost:${WS_PORT}`);
        const connected = await interaction.connect();
        expect(connected).toBe(true);
        interaction.disconnect();
    });

    it('can send intervention message', async () => {
        const interaction = new DashboardInteraction(`ws://localhost:${WS_PORT}`);
        
        let receivedMessage: any = null;
        const messageReceived = new Promise<void>((resolve) => {
            wss.once('connection', (ws) => {
                ws.on('message', (data) => {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.type === 'intervention') {
                        receivedMessage = parsed;
                        resolve();
                    }
                });
            });
        });

        await interaction.connect();
        await interaction.sendIntervention('Hello from dashboard');
        await messageReceived;
        
        expect(receivedMessage).toEqual({
            type: 'intervention',
            message: 'Hello from dashboard'
        });

        interaction.disconnect();
    });

    it('can send stop message', async () => {
        const interaction = new DashboardInteraction(`ws://localhost:${WS_PORT}`);
        
        let receivedMessage: any = null;
        const messageReceived = new Promise<void>((resolve) => {
            wss.once('connection', (ws) => {
                ws.on('message', (data) => {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.type === 'stop') {
                        receivedMessage = parsed;
                        resolve();
                    }
                });
            });
        });

        await interaction.connect();
        await interaction.sendStop();
        await messageReceived;
        
        expect(receivedMessage).toEqual({
            type: 'stop'
        });

        interaction.disconnect();
    });

    it('returns false on connection timeout', async () => {
        // 使用されていないポートを指定
        const interaction = new DashboardInteraction(`ws://localhost:9999`);
        // タイムアウトを待つので少し時間がかかる
        const connected = await interaction.connect();
        expect(connected).toBe(false);
    }, 5000);

    it('returns false on connection error', async () => {
        // 通常は接続を拒否されるポート
        const interaction = new DashboardInteraction(`ws://localhost:1`);
        const connected = await interaction.connect();
        expect(connected).toBe(false);
    });
});
