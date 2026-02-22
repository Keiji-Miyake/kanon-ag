import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from '../../src/cli/cli-resolver.js';

describe('Automatic config.json creation', () => {
    let tmpDir: string;
    let originalCwd: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanon-auto-config-test-'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should create .kanon/config.json when loadConfig() is called if no config exists', () => {
        // Ensure NODE_ENV is NOT 'test' for this test to trigger auto-creation
        // But vitest sets NODE_ENV to 'test' by default.
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        
        try {
            loadConfig();
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
        }

        const configPath = path.join(tmpDir, '.kanon', 'config.json');
        expect(fs.existsSync(configPath)).toBe(true);
        
        const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(content.agents.architect.command).toBe('gemini');
    });

    it('should NOT create .kanon/config.json if another config already exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'kanon-cli.json'), '{}');
        
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        
        try {
            loadConfig();
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
        }

        const configPath = path.join(tmpDir, '.kanon', 'config.json');
        expect(fs.existsSync(configPath)).toBe(false);
    });
});
