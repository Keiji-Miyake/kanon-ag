import { describe, it, expect, beforeEach } from 'vitest';
import { AjvOutputValidator } from '../../../src/infrastructure/validation/ajvOutputValidator.js';
import { OutputContract } from '../../../src/domain/models/promptFacet.js';

describe('AjvOutputValidator', () => {
    let validator: AjvOutputValidator;

    beforeEach(() => {
        validator = new AjvOutputValidator();
    });

    it('should validate valid JSON and schema correctly', async () => {
        const contract: OutputContract = {
            format: 'json',
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' }
                },
                required: ['name', 'age']
            }
        };
        const output = '{"name": "Alice", "age": 30}';
        const result = await validator.validate(output, contract);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.parsedData).toEqual({ name: 'Alice', age: 30 });
    });

    it('should validate JSON with code block correctly', async () => {
        const contract: OutputContract = {
            format: 'json',
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string' }
                },
                required: ['name']
            }
        };
        const output = `
Some introductory text.
\`\`\`json
{"name": "Alice"}
\`\`\`
Some concluding text.
`;
        const result = await validator.validate(output, contract);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.parsedData).toEqual({ name: 'Alice' });
    });

    it('should return invalid for schema violations', async () => {
        const contract: OutputContract = {
            format: 'json',
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' },
                    role: { type: 'string', enum: ['admin', 'user'] }
                },
                required: ['name', 'age', 'role']
            }
        };

        // Case 1: Missing field
        const result1 = await validator.validate('{"name": "Alice", "age": 30}', contract);
        expect(result1.isValid).toBe(false);
        expect(result1.errors.some((err: any) => err.keyword === 'required' && err.params.missingProperty === 'role')).toBe(true);

        // Case 2: Type error
        const result2 = await validator.validate('{"name": "Alice", "age": "thirty", "role": "admin"}', contract);
        expect(result2.isValid).toBe(false);
        expect(result2.errors.some((err: any) => err.path === '/age' && err.keyword === 'type')).toBe(true);

        // Case 3: Enum violation
        const result3 = await validator.validate('{"name": "Alice", "age": 30, "role": "guest"}', contract);
        expect(result3.isValid).toBe(false);
        expect(result3.errors.some((err: any) => err.path === '/role' && err.keyword === 'enum')).toBe(true);
    });

    it('should return invalid for invalid JSON strings', async () => {
        const contract: OutputContract = {
            format: 'json',
            schema: { type: 'object' }
        };
        const output = '{"name": "Alice",}'; // Trailing comma
        const result = await validator.validate(output, contract);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toContain('Failed to parse JSON');
    });

    it('should return valid if format is not json', async () => {
        const contract: OutputContract = { format: 'markdown' as any };
        const output = '# Header';
        const result = await validator.validate(output, contract);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should return valid if schema is not provided', async () => {
        const contract: OutputContract = { format: 'json' };
        const output = '{"name": "Alice"}';
        const result = await validator.validate(output, contract);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should return error for very large JSON input (> 5MB)', async () => {
        const contract: OutputContract = {
            format: 'json',
            schema: { type: 'object' }
        };
        // 5MB 超のデータ
        const largeContent = 'a'.repeat(1024 * 1024 * 5 + 1);
        const output = `\`\`\`json\n{"data": "${largeContent}"}\n\`\`\``;
        const result = await validator.validate(output, contract);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toContain('exceeds the limit');
    });

    it('should return invalid for invalid schema in strict mode', async () => {
        const contract: OutputContract = {
            format: 'json',
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string', unknownKeyword: true } // unknownKeyword is not allowed in strict mode
                }
            }
        };
        const output = '{"name": "Alice"}';
        
        // Ajv compiles the schema when validate is called, and throws/returns error in strict mode
        const result = await validator.validate(output, contract);
        expect(result.isValid).toBe(false);
    });
});
