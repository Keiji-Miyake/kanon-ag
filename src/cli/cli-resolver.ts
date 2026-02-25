#!/usr/bin/env node
/**
 * CLI Resolver — マルチCLI 解決ロジック
 *
 * cli-config.yaml を読み込み、スキルごとに適切なCLIコマンドを構築する。
 * gemini, copilot, opencode の統一インターフェースを提供。
 *
 * Usage:
 *   npx ts-node cli-resolver.ts --detect           利用可能CLI検出
 *   npx ts-node cli-resolver.ts --build <skill>     コマンド構築
 *   npx ts-node cli-resolver.ts --test              セルフテスト
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ──────────────────────────────────────────────────

export interface CliDefinition {
    command: string;
    subcommand?: string;
    prompt_flag: string | null;
    auto_approve: string | null;
    output_format: string | null;
    workspace_flag: string | null;
    resume_flag: string | null;
}

export interface ConfigCommander {
    identity: string;
    brain: string;
}

export interface ConfigAgent {
    cli: string;
    model_primary: string;
    model_backup: string;
}

export interface CliConfig {
    language: string;
    default_cli: string;
    topology?: 'star';
    commander?: ConfigCommander;
    agents?: Record<string, ConfigAgent>;
    skill_cli_mapping: Record<string, string>;
    cli_definitions: Record<string, CliDefinition>;
    // kanon-cli.json / .kanon/config.json 拡張フィールド
    worktreeDir?: string;   // worktree 配置パス（デフォルト: "worktree"）
    maxRetries?: number;    // 自律デバッグ最大リトライ回数（デフォルト: 3）
    agentModels?: Record<string, string>; // ロール → モデル名のマッピング
}

export interface BuildCommandOptions {
    workspace?: string;
    outputFormat?: boolean;
    autoApprove?: boolean;
    additionalFlags?: string[];
    model?: string;         // 使用するモデル名（CLI の --model フラグに渡す）
}

export interface CliDetectionResult {
    name: string;
    available: boolean;
    path: string | null;
    version: string | null;
}

// ─── Config Loading ─────────────────────────────────────────

/**
 * cli-config.yaml を探索して読み込む。
 * 探索順:
 *   1. 引数 --config <path>
 *   2. .kanon/config.json  （ドットフォルダ管理・最優先）
 *   3. kanon-cli.json / .kanonrc / kanon.json（プロジェクトルート）
 *   4. .agent/config/cli-config.yaml / パッケージ同梱 yaml（フォールバック）
 */
export function loadConfig(configPath?: string): CliConfig {
    const cwd = process.cwd();

    // 1. 引数指定（最優先）
    if (configPath) {
        const resolved = path.resolve(configPath);
        if (fs.existsSync(resolved)) {
            try {
                const content = fs.readFileSync(resolved, 'utf-8');
                return resolved.endsWith('.json')
                    ? mergeJsonConfig(loadYamlConfig(cwd), JSON.parse(content))
                    : parseYaml(content);
            } catch (err) {
                console.error(`設定ファイルの読み込みに失敗しました (${resolved}):`, err);
            }
        }
    }

    // 2. .kanon/config.json（ドットフォルダ管理・kanon init が生成する正式設定）
    const kanonConfigPath = path.join(cwd, '.kanon', 'config.json');
    if (fs.existsSync(kanonConfigPath)) {
        try {
            const content = fs.readFileSync(kanonConfigPath, 'utf-8');
            const base = loadYamlConfig(cwd);
            return mergeJsonConfig(base, JSON.parse(content));
        } catch (err) {
            console.error(`kanon 設定ファイルの読み込みに失敗しました (${kanonConfigPath}):`, err);
        }
    }

    // 3. kanon-cli.json / .kanonrc / kanon.json（プロジェクトルート）
    const jsonSearchPaths = [
        path.join(cwd, 'kanon-cli.json'),
        path.join(cwd, '.kanonrc'),
        path.join(cwd, 'kanon.json'),
    ];
    for (const p of jsonSearchPaths) {
        if (fs.existsSync(p)) {
            try {
                const content = fs.readFileSync(p, 'utf-8');
                const base = loadYamlConfig(cwd);
                return mergeJsonConfig(base, JSON.parse(content));
            } catch (err) {
                console.error(`kanon 設定ファイルの読み込みに失敗しました (${p}):`, err);
            }
        }
    }

    // 4. YAML 設定（.agent/config/cli-config.yaml 層化探索）
    return loadYamlConfig(cwd);
}

/**
 * YAML 設定ファイルを層化探索して読み込む。
 * 探索順: .agent/config/cli-config.yaml → パッケージ同梱 cli-config.yaml → デフォルト設定
 */
function loadYamlConfig(cwd: string): CliConfig {
    const yamlSearchPaths = [
        path.join(cwd, '.agent', 'config', 'cli-config.yaml'),
        path.join(__dirname, 'cli-config.yaml'),
    ];
    for (const p of yamlSearchPaths) {
        if (fs.existsSync(p)) {
            try {
                const content = fs.readFileSync(p, 'utf-8');
                return parseYaml(content);
            } catch (err) {
                console.error(`設定ファイルの読み込みに失敗しました (${p}):`, err);
            }
        }
    }
    return getDefaultConfig();
}

/**
 * JSON 設定（.kanon/config.json / kanon-cli.json 等）をベース設定にマージする。
 *
 * 対応フィールド:
 *   defaultCli           → default_cli
 *   worktreeDir          → worktreeDir
 *   maxRetries           → maxRetries
 *   agentModelMapping    → skill_cli_mapping（旧形式・後方互換）
 *   agents[role].command → skill_cli_mapping[role]（.kanon/config.json 形式）
 *   agents[role].model   → agentModels[role]（モデル名の保持）
 */
export function mergeJsonConfig(base: CliConfig, json: Record<string, unknown>): CliConfig {
    const merged: CliConfig = {
        ...base,
        skill_cli_mapping: { ...base.skill_cli_mapping },
        agentModels: { ...(base.agentModels ?? {}) },
    };

    if (typeof json.defaultCli === 'string') {
        merged.default_cli = json.defaultCli;
    }
    if (typeof json.worktreeDir === 'string') {
        merged.worktreeDir = json.worktreeDir;
    }
    if (typeof json.maxRetries === 'number') {
        merged.maxRetries = json.maxRetries;
    }

    // agentModelMapping（旧形式・後方互換）: skill_cli_mapping へのマージ
    if (json.agentModelMapping && typeof json.agentModelMapping === 'object') {
        Object.assign(
            merged.skill_cli_mapping,
            json.agentModelMapping as Record<string, string>,
        );
    }

    // agents（.kanon/config.json 形式）:
    //   agents[role].command → skill_cli_mapping[role]
    //   agents[role].model   → agentModels[role]
    if (json.agents && typeof json.agents === 'object') {
        for (const [role, agentCfg] of Object.entries(json.agents as Record<string, unknown>)) {
            if (!agentCfg || typeof agentCfg !== 'object') continue;
            const cfg = agentCfg as Record<string, unknown>;

            if (typeof cfg.command === 'string') {
                merged.skill_cli_mapping[role] = cfg.command;
            }
            if (typeof cfg.model === 'string') {
                merged.agentModels![role] = cfg.model;
            }
        }
    }

    return merged;
}

/**
 * 簡易YAMLパーサー（外部依存なし）
 * cli-config.yaml の構造に特化した軽量パーサー
 */
function parseYaml(content: string): CliConfig {
    const config: CliConfig = {
        language: 'ja',
        default_cli: 'gemini',
        skill_cli_mapping: {},
        cli_definitions: {},
        agents: {},
    };

    const lines = content.split('\n');
    let currentSection = '';
    let currentKey = '';

    for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/, '').trimEnd(); // コメント除去
        if (!line.trim()) continue;

        const indent = line.length - line.trimStart().length;
        const trimmed = line.trim();

        // トップレベルのキー
        if (indent === 0 && trimmed.includes(':')) {
            const [key, ...rest] = trimmed.split(':');
            const value = rest.join(':').trim();

            if (key === 'language' && value) config.language = value;
            if (key === 'default_cli' && value) config.default_cli = value;
            if (key === 'topology' && value) config.topology = value as 'star';

            if (key === 'commander') {
                currentSection = 'commander';
                config.commander = { identity: 'Antigravity', brain: 'gemini-3-pro' }; // defaults
            } else if (key === 'agents') {
                currentSection = 'agents';
            } else if (key === 'skill_cli_mapping') {
                currentSection = 'mapping';
            } else if (key === 'cli_definitions') {
                currentSection = 'definitions';
            } else if (key !== 'skill_cli_mapping' && key !== 'cli_definitions' && key !== 'agents' && key !== 'commander') {
                currentSection = '';
            }
            continue;
        }

        // commander セクション
        if (currentSection === 'commander' && indent === 2) {
            const [key, ...rest] = trimmed.split(':');
            const value = rest.join(':').trim().replace(/^"|"$/g, '');
            if (config.commander) {
                if (key === 'identity') config.commander.identity = value;
                if (key === 'brain') config.commander.brain = value;
            }
            continue;
        }

        // agents セクション
        if (currentSection === 'agents' && indent === 2 && trimmed.endsWith(':')) {
            currentKey = trimmed.replace(':', '').trim();
            config.agents![currentKey] = { cli: 'gemini', model_primary: '', model_backup: '' };
            continue;
        }
        if (currentSection === 'agents' && currentKey && indent >= 4) {
            const [key, ...rest] = trimmed.split(':');
            const value = rest.join(':').trim().replace(/^"|"$/g, '');
            const agent = config.agents![currentKey];
            if (key === 'cli') agent.cli = value;
            if (key === 'model_primary') agent.model_primary = value;
            if (key === 'model_backup') agent.model_backup = value;
            continue;
        }

        // skill_cli_mapping のエントリ
        if (currentSection === 'mapping' && indent === 2) {
            const [key, ...rest] = trimmed.split(':');
            const value = rest.join(':').trim();
            if (key && value) {
                config.skill_cli_mapping[key.trim()] = value;
            }
            continue;
        }

        // cli_definitions のCLI名
        if (currentSection === 'definitions' && indent === 2 && trimmed.endsWith(':')) {
            currentKey = trimmed.replace(':', '').trim();
            config.cli_definitions[currentKey] = {
                command: currentKey,
                prompt_flag: null,
                auto_approve: null,
                output_format: null,
                workspace_flag: null,
                resume_flag: null,
            };
            continue;
        }

        // cli_definitions のプロパティ
        if (currentSection === 'definitions' && currentKey && indent >= 4) {
            const [key, ...rest] = trimmed.split(':');
            let value: string | null = rest.join(':').trim();

            // YAML null処理
            if (value === 'null' || value === '~' || value === '') {
                value = null;
            }
            // クォート除去
            if (value && value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }

            const def = config.cli_definitions[currentKey];
            const k = key.trim();
            if (k === 'command' && value) def.command = value;
            if (k === 'subcommand') def.subcommand = value || undefined;
            if (k === 'prompt_flag') def.prompt_flag = value;
            if (k === 'auto_approve') def.auto_approve = value;
            if (k === 'output_format') def.output_format = value;
            if (k === 'workspace_flag') def.workspace_flag = value;
            if (k === 'resume_flag') def.resume_flag = value;
        }
    }

    return config;
}

function getDefaultConfig(): CliConfig {
    return {
        language: 'ja',
        default_cli: 'gemini',
        topology: 'star',
        commander: {
            identity: 'Antigravity',
            brain: 'gemini-3-pro'
        },
        agents: {
            architect: { cli: 'gemini', model_primary: 'gemini-3-pro', model_backup: 'gemini-3-flash' },
            coder: { cli: 'opencode', model_primary: 'claude-opus-4.6', model_backup: 'claude-sonnet-4.6' },
            reviewer: { cli: 'copilot', model_primary: 'gpt-5.3-codex', model_backup: 'gpt-5.3-mini' }
        },
        skill_cli_mapping: {},
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
}

// ─── CLI Resolution ─────────────────────────────────────────

/**
 * スキル名からCLI設定を解決する。
 * 優先度: override > skill_cli_mapping > default_cli > フォールバック(gemini)
 */
export function resolveCli(
    skill: string,
    config: CliConfig,
    override?: string,
): { cliName: string; definition: CliDefinition } {
    const cliName = override
        || config.skill_cli_mapping[skill]
        || config.default_cli
        || 'gemini';

    const definition = config.cli_definitions[cliName];
    if (!definition) {
        throw new Error(`CLI定義が見つかりません: ${cliName}`);
    }

    return { cliName, definition };
}

/**
 * CLI実行コマンドを構築する。
 */
export function buildCommand(
    definition: CliDefinition,
    prompt: string,
    options: BuildCommandOptions = {},
): string {
    const parts: string[] = [definition.command];

    // サブコマンド（opencode run）
    if (definition.subcommand) {
        parts.push(definition.subcommand);
    }

    // 自動承認
    if (options.autoApprove !== false && definition.auto_approve) {
        parts.push(definition.auto_approve);
    }

    // 出力形式
    if (options.outputFormat !== false && definition.output_format) {
        parts.push(definition.output_format);
    }

    // モデル指定（--model <name>）
    if (options.model) {
        parts.push(`--model=${options.model}`);
    }

    // ワークスペース
    if (options.workspace && definition.workspace_flag) {
        parts.push(definition.workspace_flag, options.workspace);
    }

    // 追加フラグ
    if (options.additionalFlags) {
        parts.push(...options.additionalFlags);
    }

    // プロンプト（最後に追加）
    const escapedPrompt = prompt.replace(/'/g, "'\''");
    if (definition.prompt_flag) {
        parts.push(definition.prompt_flag, `'${escapedPrompt}'`);
    } else {
        // positional argument（opencode run "message"）
        parts.push(`'${escapedPrompt}'`);
    }

    return parts.join(' ');
}

/**
 * CLI実行コマンドと引数を配列として構築する（コマンドインジェクション対策用）。
 */
export function buildCommandArgs(
    definition: CliDefinition,
    prompt: string,
    options: BuildCommandOptions = {},
): { cmd: string; args: string[] } {
    const cmd = definition.command;
    const args: string[] = [];

    // サブコマンド（opencode run）
    if (definition.subcommand) {
        args.push(definition.subcommand);
    }

    // 自動承認
    if (options.autoApprove !== false && definition.auto_approve) {
        args.push(definition.auto_approve);
    }

    // 出力形式
    if (options.outputFormat !== false && definition.output_format) {
        // スペース区切りのフラグを分割して追加（例: "-o json" -> ["-o", "json"]）
        args.push(...definition.output_format.split(' ').filter(Boolean));
    }

    // モデル指定（--model <name>）
    if (options.model) {
        args.push(`--model=${options.model}`);
    }

    // ワークスペース
    if (options.workspace && definition.workspace_flag) {
        args.push(definition.workspace_flag, options.workspace);
    }

    // 追加フラグ
    if (options.additionalFlags) {
        args.push(...options.additionalFlags);
    }

    // プロンプト（最後に追加）
    if (definition.prompt_flag) {
        args.push(definition.prompt_flag, prompt);
    } else {
        // positional argument（opencode run "message"）
        args.push(prompt);
    }

    return { cmd, args };
}

// ─── CLI Detection ──────────────────────────────────────────

/**
 * 利用可能なCLIを検出する。
 */
export function detectAvailableClis(config: CliConfig): CliDetectionResult[] {
    const results: CliDetectionResult[] = [];

    for (const [name, def] of Object.entries(config.cli_definitions)) {
        const result: CliDetectionResult = {
            name,
            available: false,
            path: null,
            version: null,
        };

        try {
            const whichOutput = execSync(`which ${def.command} 2>/dev/null`, {
                encoding: 'utf-8',
            }).trim();

            if (whichOutput) {
                result.available = true;
                result.path = whichOutput;

                // バージョン取得
                try {
                    const versionOutput = execSync(`${def.command} --version 2>&1`, {
                        encoding: 'utf-8',
                        timeout: 5000,
                    }).trim();
                    // 最初の行からバージョン番号を抽出
                    const versionMatch = versionOutput.match(/[\d]+\.[\d]+\.[\d]+/);
                    result.version = versionMatch ? versionMatch[0] : versionOutput.split('\n')[0];
                } catch {
                    // バージョン取得失敗は無視
                }
            }
        } catch {
            // CLI未インストール
        }

        results.push(result);
    }

    return results;
}

// ─── Self-Test ──────────────────────────────────────────────

function selfTest(): void {
    console.log('\n═══════════════════════════════════════════');
    console.log('  🧪 CLI Resolver Self-Test');
    console.log('═══════════════════════════════════════════\n');

    let passed = 0;
    let total = 0;

    function assert(condition: boolean, message: string): void {
        total++;
        if (condition) {
            console.log(`  ✅ ${message}`);
            passed++;
        } else {
            console.log(`  ❌ ${message}`);
        }
    }

    // Test 1: YAML パース
    console.log('  [1/5] YAML パース...');
    const yamlContent = `
language: ja
default_cli: gemini

skill_cli_mapping:
  conductor: gemini
  developer: copilot

cli_definitions:
  gemini:
    command: gemini
    prompt_flag: "-p"
    auto_approve: "--approval-mode=yolo"
    output_format: "-o json"
    workspace_flag: "--include-directories"
    resume_flag: "--resume"
  copilot:
    command: copilot
    prompt_flag: "-p"
    auto_approve: "--yolo"
    output_format: "--quiet"
    workspace_flag: "--add-dir"
    resume_flag: "--resume"
  opencode:
    command: opencode
    subcommand: run
    prompt_flag: null
    auto_approve: null
    output_format: "--format json"
    workspace_flag: null
    resume_flag: "--continue"
`;
    const config = parseYaml(yamlContent);
    assert(config.language === 'ja', 'language = ja');
    assert(config.default_cli === 'gemini', 'default_cli = gemini');
    assert(config.skill_cli_mapping['conductor'] === 'gemini', 'mapping: conductor → gemini');
    assert(config.skill_cli_mapping['developer'] === 'copilot', 'mapping: developer → copilot');
    assert(config.cli_definitions['gemini'].command === 'gemini', 'gemini command');
    assert(config.cli_definitions['gemini'].prompt_flag === '-p', 'gemini prompt_flag');
    assert(config.cli_definitions['opencode'].subcommand === 'run', 'opencode subcommand');
    assert(config.cli_definitions['opencode'].prompt_flag === null, 'opencode prompt_flag = null');

    // Test 2: resolveCli
    console.log('\n  [2/5] resolveCli...');
    const r1 = resolveCli('conductor', config);
    assert(r1.cliName === 'gemini', 'conductor → gemini (from mapping)');
    const r2 = resolveCli('developer', config);
    assert(r2.cliName === 'copilot', 'developer → copilot (from mapping)');
    const r3 = resolveCli('qa', config); // not in mapping → default
    assert(r3.cliName === 'gemini', 'qa → gemini (default)');
    const r4 = resolveCli('qa', config, 'opencode'); // override
    assert(r4.cliName === 'opencode', 'qa → opencode (override)');

    // Test 3: buildCommand (gemini)
    console.log('\n  [3/5] buildCommand (gemini)...');
    const cmd1 = buildCommand(config.cli_definitions['gemini'], 'SPEC.md を作成して');
    assert(cmd1.includes('gemini'), 'gemini コマンド含む');
    assert(cmd1.includes('--approval-mode=yolo'), 'auto_approve 含む');
    assert(cmd1.includes('-o json'), 'output_format 含む');
    assert(cmd1.includes("-p"), 'prompt_flag 含む');
    assert(cmd1.includes('SPEC.md を作成して'), 'プロンプト含む');

    // Test 4: buildCommand (copilot)
    console.log('\n  [4/5] buildCommand (copilot)...');
    const cmd2 = buildCommand(config.cli_definitions['copilot'], 'テスト実行', {
        workspace: '/home/user/project',
    });
    assert(cmd2.includes('copilot'), 'copilot コマンド含む');
    assert(cmd2.includes('--yolo'), 'auto_approve 含む');
    assert(cmd2.includes('--add-dir /home/user/project'), 'workspace 含む');
    assert(cmd2.includes("-p"), 'prompt_flag 含む');

    // Test 5: buildCommand (opencode)
    console.log('\n  [5/5] buildCommand (opencode)...');
    const cmd3 = buildCommand(config.cli_definitions['opencode'], 'コード生成して');
    assert(cmd3.includes('opencode run'), 'opencode run 含む');
    assert(cmd3.includes('--format json'), 'output_format 含む');
    assert(!cmd3.includes('-p'), 'prompt_flag なし (positional)');
    assert(cmd3.includes('コード生成して'), 'プロンプト含む (positional)');

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  ${passed === total ? '🎉' : '⚠️'} テスト結果: ${passed}/${total} 合格`);
    console.log('═══════════════════════════════════════════\n');

    process.exit(passed === total ? 0 : 1);
}

// ─── CLI Commands ───────────────────────────────────────────

function showDetection(): void {
    const config = loadConfig();
    const results = detectAvailableClis(config);

    console.log('\n═══════════════════════════════════════════');
    console.log('  🔍 CLI Detection');
    console.log('═══════════════════════════════════════════\n');

    for (const r of results) {
        const icon = r.available ? '✅' : '❌';
        console.log(`  ${icon} ${r.name}`);
        if (r.available) {
            console.log(`     パス: ${r.path}`);
            console.log(`     バージョン: ${r.version || '不明'}`);
        } else {
            console.log(`     未インストール`);
        }
        console.log('');
    }

    console.log('  設定:');
    console.log(`    デフォルトCLI: ${config.default_cli}`);
    console.log(`    マッピング:`);
    for (const [skill, cli] of Object.entries(config.skill_cli_mapping)) {
        const available = results.find((r) => r.name === cli)?.available ? '✅' : '❌';
        console.log(`      ${skill} → ${cli} ${available}`);
    }
    console.log('');
}

function showBuild(skill: string): void {
    const config = loadConfig();
    const { cliName, definition } = resolveCli(skill, config);
    const cmd = buildCommand(definition, `<prompt for ${skill}>`, {
        autoApprove: true,
        outputFormat: true,
    });

    console.log(`\n  スキル: ${skill}`);
    console.log(`  CLI:   ${cliName}`);
    console.log(`  コマンド: ${cmd}\n`);
}

function main(): void {
    const args = process.argv.slice(2);

    if (args.includes('--test')) {
        selfTest();
        return;
    }

    if (args.includes('--detect')) {
        showDetection();
        return;
    }

    const buildIdx = args.indexOf('--build');
    if (buildIdx !== -1 && args[buildIdx + 1]) {
        showBuild(args[buildIdx + 1]);
        return;
    }

    console.log(`
  CLI Resolver — マルチCLI 解決ロジック

  Usage:
    npx ts-node cli-resolver.ts --detect           利用可能CLI検出
    npx ts-node cli-resolver.ts --build <skill>     コマンド構築プレビュー
    npx ts-node cli-resolver.ts --test              セルフテスト
`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    main();
}
