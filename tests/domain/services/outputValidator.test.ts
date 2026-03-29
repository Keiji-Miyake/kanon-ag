import { describe, it, expect } from 'vitest';
import { OutputValidator } from '../../../src/domain/services/outputValidator.js';
import { OutputContract } from '../../../src/domain/models/promptFacet.js';

describe('OutputValidator', () => {
    const validator = new OutputValidator();

    it('有効なJSONを正しく検証できること', () => {
        const contract: OutputContract = { format: 'json' };
        const output = '{"key": "value"}';
        const result = validator.validate(output, contract);
        expect(result.isValid).toBe(true);
        expect(result.parsedData).toEqual({ key: 'value' });
    });

    it('コードブロック内のJSONを正しく抽出して検証できること', () => {
        const contract: OutputContract = { format: 'json' };
        const output = 'Here is the result:\n```json\n{"status": "ok"}\n```';
        const result = validator.validate(output, contract);
        expect(result.isValid).toBe(true);
        expect(result.parsedData).toEqual({ status: 'ok' });
    });

    it('不正なJSONの場合にエラーを返すこと', () => {
        const contract: OutputContract = { format: 'json' };
        const output = '{"invalid": json}';
        const result = validator.validate(output, contract);
        expect(result.isValid).toBe(false);
        expect(result.errors[0]).toContain('Failed to parse JSON');
    });

    it('Markdownが空の場合にエラーを返すこと', () => {
        const contract: OutputContract = { format: 'markdown' };
        const output = '   ';
        const result = validator.validate(output, contract);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Output is empty');
    });
});
