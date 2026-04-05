export class OutputValidationService {
    jsonValidator;
    constructor(jsonValidator) {
        this.jsonValidator = jsonValidator;
    }
    /**
     * エージェントの出力をContractに基づき検証する
     */
    async validate(output, contract) {
        switch (contract.format) {
            case 'json':
                return this.validateJson(output, contract);
            case 'markdown':
                return this.validateMarkdown(output);
            case 'text':
                return { isValid: true, errors: [] };
            default:
                return {
                    isValid: false,
                    errors: [{ path: '', message: `Unsupported format: ${contract.format}` }]
                };
        }
    }
    async validateJson(output, contract) {
        if (this.jsonValidator) {
            return this.jsonValidator.validate(output, contract);
        }
        // 基本的なパース検証のみ（Validatorが注入されていない場合のフォールバック）
        try {
            const data = this.parseJsonBasic(output);
            return {
                isValid: true,
                errors: [],
                parsedData: data
            };
        }
        catch (error) {
            return {
                isValid: false,
                errors: [{
                        path: '',
                        message: error instanceof Error ? error.message : 'Unknown parsing error'
                    }]
            };
        }
    }
    parseJsonBasic(output) {
        const regex = /```json(?::[a-z-]+)?\s+([\s\S]*?)\s+```/g;
        const match = regex.exec(output);
        const jsonContent = match ? match[1] : output;
        return JSON.parse(jsonContent.trim());
    }
    validateMarkdown(output) {
        if (!output || output.trim().length === 0) {
            return {
                isValid: false,
                errors: [{ path: '', message: 'Output is empty' }]
            };
        }
        return { isValid: true, errors: [] };
    }
}
