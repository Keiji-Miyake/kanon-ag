import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Types
export interface Check {
    type: 'file_exists' | 'file_not_empty' | 'glob_exists' | 'command';
    path?: string;
    pattern?: string;
    exclude?: string[];
    command?: string;
    description?: string;
}

export interface CheckResult {
    check: Check;
    passed: boolean;
    message: string;
}

// Logging
const ICONS = { INFO: 'ℹ️ ', SUCCESS: '✅', ERROR: '❌', PHASE: '🔹' } as const;

export function log(message: string, type: keyof typeof ICONS = 'INFO'): void {
    console.log(`  ${ICONS[type]} ${message}`);
}

// Validators
function checkFileExists(filePath: string, baseDir: string = process.cwd()): CheckResult {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    const exists = fs.existsSync(fullPath);
    return {
        check: { type: 'file_exists', path: filePath },
        passed: exists,
        message: exists
            ? `ファイル検出: ${filePath}`
            : `ファイル未検出: ${filePath}`,
    };
}

function checkFileNotEmpty(filePath: string, baseDir: string = process.cwd()): CheckResult {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    if (!fs.existsSync(fullPath)) {
        return {
            check: { type: 'file_not_empty', path: filePath },
            passed: false,
            message: `ファイル未検出: ${filePath}`,
        };
    }
    const content = fs.readFileSync(fullPath, 'utf-8').trim();
    const notEmpty = content.length > 0;
    return {
        check: { type: 'file_not_empty', path: filePath },
        passed: notEmpty,
        message: notEmpty
            ? `ファイル内容あり: ${filePath} (${content.length} chars)`
            : `ファイルが空です: ${filePath}`,
    };
}

function checkGlobExists(pattern: string, exclude: string[] = [], baseDir: string = process.cwd()): CheckResult {
    try {
        const filePattern = pattern.split('/').pop() || pattern;
        const ignoreArgs = exclude.map((e) => `--not -path './${e}'`).join(' ');
        const cmd = `find "${baseDir}" -name '${filePattern}' ${ignoreArgs} -type f 2>/dev/null | head -5`;
        const output = execSync(cmd, { encoding: 'utf-8' }).trim();
        const files = output ? output.split('\n') : [];
        const found = files.length > 0;
        return {
            check: { type: 'glob_exists', pattern },
            passed: found,
            message: found
                ? `パターン "${pattern}" に一致するファイル: ${files.length}件 (${files.slice(0, 3).join(', ')})`
                : `パターン "${pattern}" に一致するファイルが見つかりません`,
        };
    } catch {
        return {
            check: { type: 'glob_exists', pattern },
            passed: false,
            message: `パターン "${pattern}" のチェック中にエラーが発生`,
        };
    }
}

function checkCommand(command: string, description?: string, baseDir: string = process.cwd()): CheckResult {
    const label = description || command;
    try {
        execSync(command, { cwd: baseDir, stdio: 'pipe', timeout: 60000 });
        return {
            check: { type: 'command', command, description },
            passed: true,
            message: `コマンド成功: ${label}`,
        };
    } catch (e: unknown) {
        const error = e as { stderr?: Buffer; message?: string };
        const stderr = error.stderr?.toString().trim().split('\n').slice(0, 5).join('\n') || '';
        return {
            check: { type: 'command', command, description },
            passed: false,
            message: `コマンド失敗: ${label}\n${stderr}`,
        };
    }
}

// Main validation function
export function validateCheck(check: Check, baseDir: string = process.cwd()): CheckResult {
    switch (check.type) {
        case 'file_exists':
            return checkFileExists(check.path!, baseDir);
        case 'file_not_empty':
            return checkFileNotEmpty(check.path!, baseDir);
        case 'glob_exists':
            return checkGlobExists(check.pattern!, check.exclude, baseDir);
        case 'command':
            return checkCommand(check.command!, check.description, baseDir);
        default:
            return {
                check,
                passed: false,
                message: `不明なチェックタイプ: ${(check as Check).type}`,
            };
    }
}
