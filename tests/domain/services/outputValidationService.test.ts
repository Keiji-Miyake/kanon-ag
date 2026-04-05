import { describe, it, expect } from 'vitest';
import { OutputValidationService } from '../../../src/domain/services/outputValidationService.js';
import { OutputContract } from '../../../src/domain/models/promptFacet.js';

describe('OutputValidationService', () => {
    const service = new OutputValidationService();

    it('有効なJSONを正しく検証できること', async () => {
        const contract: OutputContract = { format: 'json' };
        const output = '{"key": "value"}';
        const result = await service.validate(output, contract);
        expect(result.isValid).toBe(true);
        expect(result.parsedData).toEqual({ key: 'value' });
    });

    it('コードブロック内のJSONを正しく抽出して検証できること', async () => {
        const contract: OutputContract = { format: 'json' };
        const output = `Here is the result:
\`\`\`json
{"status": "ok"}
\`\`\` `;
        const result = await service.validate(output, contract);
        expect(result.isValid).toBe(true);
        expect(result.parsedData).toEqual({ status: 'ok' });
    });

    it('不正なJSONの場合にエラーを返すこと', async () => {
        const contract: OutputContract = { format: 'json' };
        const output = '{"invalid": json}';
        const result = await service.validate(output, contract);
        expect(result.isValid).toBe(false);
    });

    it('Markdownが空の場合にエラーを返すこと', async () => {
        const contract: OutputContract = { format: 'markdown' };
        const output = '   ';
        const result = await service.validate(output, contract);
        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toContain('Output is empty');
    });
});
