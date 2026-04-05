import Ajv, { Schema, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { IOutputValidator } from '../../domain/services/outputValidator.js';
import { OutputContract } from '../../domain/models/promptFacet.js';
import { ValidationResult, ValidationError } from '../../domain/models/validation.js';

const MAX_SCHEMA_CACHE_SIZE = 100;
const MAX_JSON_STRING_LENGTH = 1024 * 1024 * 5; // 5MB limit

/**
 * Ajv (Another JSON Schema Validator) を使用した出力バリデーター。
 */
export class AjvOutputValidator implements IOutputValidator {
    private ajv: Ajv;
    private schemaCache: Map<string, ValidateFunction> = new Map();

    constructor() {
        // AJVインスタンスの初期化
        this.ajv = new Ajv({
            allErrors: true, // 全てのエラーを取得
            strict: true,    // スキーマの厳格モードをオン（セキュリティ強化）
            useDefaults: true
        });
        addFormats(this.ajv);
    }

    /**
     * 出力データをJSON Schemaに基づき検証する
     */
    public async validate(output: string, contract: OutputContract): Promise<ValidationResult> {
        // 巨大な入力による攻撃を防ぐための文字列長チェック
        if (output.length > MAX_JSON_STRING_LENGTH) {
            return {
                isValid: false,
                errors: [{
                    path: '',
                    message: `Output length exceeds the limit of ${MAX_JSON_STRING_LENGTH} characters.`
                }]
            };
        }

        if (contract.format !== 'json' || !contract.schema) {
            // JSONフォーマット以外、またはスキーマ未定義の場合はパス（基本バリデーションはService側で実施済みと想定）
            return { isValid: true, errors: [] };
        }

        try {
            const data = this.parseJson(output);
            const validate = this.getCompiledSchema(contract.schema);
            const valid = validate(data);

            if (valid) {
                return {
                    isValid: true,
                    errors: [],
                    parsedData: data
                };
            } else {
                const errors: ValidationError[] = (validate.errors || []).map(err => ({
                    path: err.instancePath || '',
                    message: err.message || 'Unknown error',
                    keyword: err.keyword,
                    params: err.params as Record<string, unknown>
                }));

                return {
                    isValid: false,
                    errors,
                    parsedData: data
                };
            }
        } catch (error) {
            return {
                isValid: false,
                errors: [{
                    path: '',
                    message: error instanceof Error ? error.message : 'JSON parse error'
                }]
            };
        }
    }

    private parseJson(output: string): any {
        // JSONコードブロックの抽出
        const regex = /```json(?::[a-z-]+)?\s+([\s\S]*?)\s+```/g;
        const match = regex.exec(output);
        const jsonContent = (match ? match[1] : output).trim();

        // 抽出後のコンテンツも長さチェック
        if (jsonContent.length > MAX_JSON_STRING_LENGTH) {
            throw new Error(`JSON content length exceeds the limit of ${MAX_JSON_STRING_LENGTH} characters.`);
        }
        
        try {
            return JSON.parse(jsonContent);
        } catch (e) {
            throw new Error(`Failed to parse JSON: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
    }

    private getCompiledSchema(schema: Record<string, unknown>): ValidateFunction {
        const schemaKey = JSON.stringify(schema);
        
        // LRU 的なキャッシュ管理: 既存のエントリがある場合は一旦削除して末尾に追加し直す（最新とする）
        if (this.schemaCache.has(schemaKey)) {
            const validate = this.schemaCache.get(schemaKey)!;
            this.schemaCache.delete(schemaKey);
            this.schemaCache.set(schemaKey, validate);
            return validate;
        }

        const validate = this.ajv.compile(schema as Schema);

        // キャッシュサイズ上限チェック
        if (this.schemaCache.size >= MAX_SCHEMA_CACHE_SIZE) {
            // Map の最初の要素（最も古い挿入要素）を削除
            const firstKey = this.schemaCache.keys().next().value;
            if (firstKey !== undefined) {
                this.schemaCache.delete(firstKey);
            }
        }

        this.schemaCache.set(schemaKey, validate);
        return validate;
    }
}
