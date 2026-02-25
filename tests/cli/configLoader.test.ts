import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { mergeJsonConfig, loadConfig } from '../../src/cli/cli-resolver.js';
import { CliConfig } from '../../src/cli/cli-resolver.js';

// ===================================================================
// mergeJsonConfig のユニットテスト
// ===================================================================
describe('mergeJsonConfig()', () => {
    const baseConfig: CliConfig = {
        language: 'ja',
        default_cli: 'gemini',
        skill_cli_mapping: { conductor: 'gemini' },
        cli_definitions: {
            gemini: {
                command: 'gemini',
                prompt_flag: '-p',
                auto_approve: '--approval-mode=yolo',
                output_format: '-o json',
                workspace_flag: '--include-directories',
                resume_flag: '--resume',
            },
        },
    };

    it('defaultCli が上書きされる', () => {
        const result = mergeJsonConfig(baseConfig, { defaultCli: 'opencode' });
        expect(result.default_cli).toBe('opencode');
    });

    it('worktreeDir が設定される', () => {
        const result = mergeJsonConfig(baseConfig, { worktreeDir: 'custom-worktree' });
        expect(result.worktreeDir).toBe('custom-worktree');
    });

    it('maxRetries が設定される', () => {
        const result = mergeJsonConfig(baseConfig, { maxRetries: 5 });
        expect(result.maxRetries).toBe(5);
    });

    it('agentModelMapping が skill_cli_mapping にマージされる', () => {
        const result = mergeJsonConfig(baseConfig, {
            agentModelMapping: { developer: 'opencode', reviewer: 'copilot' },
        });
        expect(result.skill_cli_mapping.conductor).toBe('gemini');  // 既存は保持
        expect(result.skill_cli_mapping.developer).toBe('opencode');
        expect(result.skill_cli_mapping.reviewer).toBe('copilot');
    });

    it('agents[role].command が skill_cli_mapping にマッピングされる（.kanon/config.json 形式）', () => {
        const result = mergeJsonConfig(baseConfig, {
            agents: {
                architect: { command: 'gemini', model: 'gemini-3.1-pro' },
                developer: { command: 'opencode', model: 'claude-4.6-opus' },
                reviewer: { command: 'copilot', model: 'gpt-5.3-codex' },
            },
        });
        expect(result.skill_cli_mapping.architect).toBe('gemini');
        expect(result.skill_cli_mapping.developer).toBe('opencode');
        expect(result.skill_cli_mapping.reviewer).toBe('copilot');
        // モデル名が agentModels に保持されること
        expect(result.agentModels?.architect).toBe('gemini-3.1-pro');
        expect(result.agentModels?.developer).toBe('claude-4.6-opus');
        expect(result.agentModels?.reviewer).toBe('gpt-5.3-codex');
    });

    it('空の JSON → ベース設定をそのまま返す', () => {
        const result = mergeJsonConfig(baseConfig, {});
        expect(result.default_cli).toBe('gemini');
        expect(result.worktreeDir).toBeUndefined();
        expect(result.maxRetries).toBeUndefined();
    });

    it('元のベース設定オブジェクトは変更されない（イミュータブル）', () => {
        mergeJsonConfig(baseConfig, { defaultCli: 'copilot', worktreeDir: 'wt', maxRetries: 5 });
        expect(baseConfig.default_cli).toBe('gemini');
        expect(baseConfig.worktreeDir).toBeUndefined();
    });
});

// ===================================================================
// loadConfig() - kanon-cli.json 読み込みの統合テスト
// ===================================================================
describe('loadConfig() - kanon-cli.json の読み込み', () => {
    let tmpDir: string;
    let originalCwd: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanon-config-test-'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('kanon-cli.json が存在する場合、worktreeDir と maxRetries が反映される', () => {
        const configContent = JSON.stringify({
            defaultCli: 'copilot',
            worktreeDir: 'custom-wt',
            maxRetries: 7,
        });
        fs.writeFileSync(path.join(tmpDir, 'kanon-cli.json'), configContent, 'utf-8');

        const config = loadConfig();
        expect(config.default_cli).toBe('copilot');
        expect(config.worktreeDir).toBe('custom-wt');
        expect(config.maxRetries).toBe(7);
    });

    it('.kanonrc が存在する場合も読み込まれる', () => {
        const configContent = JSON.stringify({ worktreeDir: 'wt-from-kanonrc' });
        fs.writeFileSync(path.join(tmpDir, '.kanonrc'), configContent, 'utf-8');

        const config = loadConfig();
        expect(config.worktreeDir).toBe('wt-from-kanonrc');
    });

    it('.kanon/config.json が存在する場合、agents が正しくマッピングされる', () => {
        const kanonDir = path.join(tmpDir, '.kanon');
        fs.mkdirSync(kanonDir, { recursive: true });
        const configContent = JSON.stringify({
            agents: {
                architect: { command: 'gemini', model: 'gemini-3.1-pro' },
                developer: { command: 'opencode', model: 'claude-4.6-opus' },
                reviewer: { command: 'copilot', model: 'gpt-5.3-codex' },
            },
        });
        fs.writeFileSync(path.join(kanonDir, 'config.json'), configContent, 'utf-8');

        const config = loadConfig();
        // CLI割り当てが skill_cli_mapping に反映されること
        expect(config.skill_cli_mapping.architect).toBe('gemini');
        expect(config.skill_cli_mapping.developer).toBe('opencode');
        expect(config.skill_cli_mapping.reviewer).toBe('copilot');
        // モデル名が agentModels に保持されること
        expect(config.agentModels?.architect).toBe('gemini-3.1-pro');
        expect(config.agentModels?.developer).toBe('claude-4.6-opus');
        expect(config.agentModels?.reviewer).toBe('gpt-5.3-codex');
    });

    it('.kanon/config.json は kanon-cli.json より優先される', () => {
        // .kanon/config.json を作成
        const kanonDir = path.join(tmpDir, '.kanon');
        fs.mkdirSync(kanonDir, { recursive: true });
        fs.writeFileSync(
            path.join(kanonDir, 'config.json'),
            JSON.stringify({ agents: { architect: { command: 'opencode', model: 'claude-4.6' } } }),
            'utf-8',
        );
        // kanon-cli.json も作成（後順なので負けるはず）
        fs.writeFileSync(
            path.join(tmpDir, 'kanon-cli.json'),
            JSON.stringify({ defaultCli: 'copilot' }),
            'utf-8',
        );

        const config = loadConfig();
        // .kanon/config.json が優先されるため architect は opencode
        expect(config.skill_cli_mapping.architect).toBe('opencode');
    });

    it('kanon-cli.json が存在しない場合、worktreeDir は undefined', () => {
        const config = loadConfig();
        expect(config.worktreeDir).toBeUndefined();
    });
});

// ===================================================================
// buildCommand の model オプションテスト
// ===================================================================
import { buildCommand } from '../../src/cli/cli-resolver.js';
import type { CliDefinition } from '../../src/cli/cli-resolver.js';

describe('buildCommand() - model オプション', () => {
    const geminiDef: CliDefinition = {
        command: 'gemini',
        prompt_flag: '-p',
        auto_approve: '--approval-mode=yolo',
        output_format: '-o json',
        workspace_flag: '--include-directories',
        resume_flag: '--resume',
    };

    it('model が指定された場合 --model=<name> が含まれる', () => {
        const cmd = buildCommand(geminiDef, 'テスト', { model: 'gemini-3.1-pro' });
        expect(cmd).toContain('--model=gemini-3.1-pro');
    });

    it('model が未指定の場合 --model は含まれない', () => {
        const cmd = buildCommand(geminiDef, 'テスト');
        expect(cmd).not.toContain('--model');
    });

    it('--model は auto_approve の後、workspace の前に配置される', () => {
        const cmd = buildCommand(geminiDef, 'テスト', {
            model: 'gemini-3.1-pro',
            workspace: '/tmp/project',
        });
        const modelIdx = cmd.indexOf('--model=gemini-3.1-pro');
        const approveIdx = cmd.indexOf('--approval-mode=yolo');
        const workspaceIdx = cmd.indexOf('--include-directories');
        expect(approveIdx).toBeLessThan(modelIdx);
        expect(modelIdx).toBeLessThan(workspaceIdx);
    });
});
