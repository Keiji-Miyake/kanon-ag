import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ENV_SH_PATH = path.resolve('.takt/.runtime/env.sh');

describe('.takt/.runtime/env.sh', () => {
    it('ファイルが存在する', () => {
        expect(fs.existsSync(ENV_SH_PATH)).toBe(true);
    });

    describe('GH_CONFIG_DIR', () => {
        let content: string;

        beforeEach(() => {
            content = fs.readFileSync(ENV_SH_PATH, 'utf-8');
        });

        // Given: env.sh が存在する
        // When: 内容を読み込む
        // Then: GH_CONFIG_DIR が export されている
        it('GH_CONFIG_DIR がエクスポートされている', () => {
            expect(content).toMatch(/export\s+GH_CONFIG_DIR=/);
        });

        // Given: env.sh に GH_CONFIG_DIR が定義されている
        // When: その値を確認する
        // Then: $HOME/.config/gh を指している
        it('GH_CONFIG_DIR が $HOME/.config/gh を指している', () => {
            expect(content).toMatch(/export\s+GH_CONFIG_DIR=["']?\$HOME\/\.config\/gh["']?/);
        });

        // Given: XDG_CONFIG_HOME が TAKT runtime ディレクトリに上書きされている
        // When: GH_CONFIG_DIR の定義位置を確認する
        // Then: XDG_CONFIG_HOME の定義より後に配置されている（gh がそちらを優先できる）
        it('GH_CONFIG_DIR が XDG_CONFIG_HOME の定義より後に配置されている', () => {
            const xdgIdx = content.indexOf('XDG_CONFIG_HOME=');
            const ghIdx = content.indexOf('GH_CONFIG_DIR=');
            expect(xdgIdx).toBeGreaterThanOrEqual(0);
            expect(ghIdx).toBeGreaterThanOrEqual(0);
            expect(ghIdx).toBeGreaterThan(xdgIdx);
        });
    });
});
