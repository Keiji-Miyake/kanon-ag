import { OutputContract, ValidationResult } from '../models/promptFacet.js';

export class OutputValidator {
    /**
     * エージェントの出力をContractに基づき検証する
     */
    public validate(output: string, contract: OutputContract): ValidationResult {
        switch (contract.format) {
            case 'json':
                return this.validateJson(output, contract.schema);
            case 'markdown':
                return this.validateMarkdown(output);
            case 'text':
                return { isValid: true, errors: [] };
            default:
                return { isValid: false, errors: [`Unsupported format: ${(contract as any).format}`] };
        }
    }

    private validateJson(output: string, schema?: Record<string, unknown>): ValidationResult {
        // 1. JSONコードブロックの抽出を試みる
        const regex = /```json\s+([\s\S]*?)\s+```/g;
        const match = regex.exec(output);
        const jsonContent = match ? match[1] : output;

        try {
            const parsedData = JSON.parse(jsonContent);
            
            // TODO: JSON Schema検証 (ajv等の導入が必要)
            // 現状はパース成功のみを確認
            
            return {
                isValid: true,
                errors: [],
                parsedData
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
            return {
                isValid: false,
                errors: [`Failed to parse JSON: ${errorMessage}`]
            };
        }
    }

    private validateMarkdown(output: string): ValidationResult {
        // 最小限のMarkdown形式チェック（空でないこと、あるいは見出しの存在など）
        if (!output || output.trim().length === 0) {
            return { isValid: false, errors: ['Output is empty'] };
        }
        return { isValid: true, errors: [] };
    }
}
