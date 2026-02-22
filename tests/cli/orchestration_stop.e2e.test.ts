import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import * as path from 'path';

describe('Orchestration Stop E2E', () => {
    let uiServer: ChildProcess;
    let cliProcess: ChildProcess;
    const WS_PORT = 3002; // ポートを変更して衝突を避ける

    beforeEach(async () => {
        // UI サーバーを起動
        uiServer = spawn('node', ['dist/cli/orchestrate.js', 'ui'], {
            cwd: process.cwd(),
            env: { ...process.env, WS_PORT: WS_PORT.toString() },
            detached: true
        });

        uiServer.stdout?.on('data', (data) => console.log(`[UI STDOUT] ${data.toString()}`));
        uiServer.stderr?.on('data', (data) => console.error(`[UI STDERR] ${data.toString()}`));

        // サーバー起動待ち
        await new Promise(resolve => setTimeout(resolve, 5000));
    });

    afterEach(() => {
        if (uiServer && uiServer.pid) {
            try { process.kill(-uiServer.pid, 'SIGTERM'); } catch { /* ignore */ }
        }
        if (cliProcess && cliProcess.pid) {
            try { process.kill(-cliProcess.pid, 'SIGTERM'); } catch { /* ignore */ }
        }
    });

    it('WebSocket 経由で stop メッセージを送ると CLI プロセスが終了する', async () => {
        // CLI を起動
        cliProcess = spawn('node', ['dist/cli/orchestrate.js', 'execute', '--task', 'sleep 100'], {
            cwd: process.cwd(),
            env: { ...process.env, WS_PORT: WS_PORT.toString() },
            detached: true
        });

        cliProcess.stdout?.on('data', (data) => console.log(`[CLI STDOUT] ${data.toString()}`));
        cliProcess.stderr?.on('data', (data) => console.error(`[CLI STDERR] ${data.toString()}`));

        // CLI がサーバーに接続するのを待つ
        await new Promise(resolve => setTimeout(resolve, 8000));

        const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
        
        const connected = await new Promise<boolean>((resolve) => {
            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'identify', clientType: 'webview' }));
                resolve(true);
            });
            ws.on('error', () => resolve(false));
            setTimeout(() => resolve(false), 5000);
        });

        expect(connected).toBe(true);

        // Stop メッセージを送信
        ws.send(JSON.stringify({ type: 'stop' }));

        // CLI プロセスが終了するのを待つ
        const exitPromise = new Promise<number | null>((resolve) => {
            cliProcess.on('exit', (code) => resolve(code));
        });

        const exitCode = await Promise.race([
            exitPromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
        ]);

        expect(exitCode).not.toBeNull();
        ws.close();
    }, 30000);
});
