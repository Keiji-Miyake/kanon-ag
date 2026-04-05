import { OutputContract } from '../models/promptFacet.js';
import { ValidationResult } from '../models/validation.js';

export interface IOutputValidator {
    /**
     * エージェントの出力を検証する
     * @param output エージェントが出力した生テキスト
     * @param contract 出力定義（フォーマット、スキーマ等）
     */
    validate(output: string, contract: OutputContract): Promise<ValidationResult>;
}
