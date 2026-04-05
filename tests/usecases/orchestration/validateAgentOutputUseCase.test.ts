import { describe, it, expect, vi } from 'vitest';
import { ValidateAgentOutputUseCase } from '../../../src/usecases/orchestration/validateAgentOutputUseCase.js';
import { IOutputValidator } from '../../../src/domain/services/outputValidator.js';
import { OutputContract } from '../../../src/domain/models/promptFacet.js';

describe('ValidateAgentOutputUseCase', () => {
    it('should delegate JSON validation to OutputValidationService (and thus IOutputValidator)', async () => {
        const mockValidator: IOutputValidator = {
            validate: vi.fn().mockResolvedValue({
                isValid: true,
                errors: [],
                parsedData: { success: true }
            })
        };
        const useCase = new ValidateAgentOutputUseCase(mockValidator);
        const contract: OutputContract = { format: 'json', schema: {} };
        const output = '{"success": true}';

        const result = await useCase.execute(output, contract);

        expect(result.isValid).toBe(true);
        expect(mockValidator.validate).toHaveBeenCalledWith(output, contract);
        expect(result.parsedData).toEqual({ success: true });
    });

    it('should handle markdown format', async () => {
        const useCase = new ValidateAgentOutputUseCase(undefined as any);
        const contract: OutputContract = { format: 'markdown' };
        const output = '# Hello';

        const result = await useCase.execute(output, contract);
        expect(result.isValid).toBe(true);
    });

    it('should return invalid for empty markdown', async () => {
        const useCase = new ValidateAgentOutputUseCase(undefined as any);
        const contract: OutputContract = { format: 'markdown' };
        const output = '';

        const result = await useCase.execute(output, contract);
        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toBe('Output is empty');
    });

    it('should handle text format', async () => {
        const useCase = new ValidateAgentOutputUseCase(undefined as any);
        const contract: OutputContract = { format: 'text' };
        const output = 'Hello World';

        const result = await useCase.execute(output, contract);
        expect(result.isValid).toBe(true);
    });

    it('should handle cases where no validator is provided (default behavior for JSON)', async () => {
        const useCase = new ValidateAgentOutputUseCase(undefined as any);
        const contract: OutputContract = { format: 'json' };
        const output = '{"success": true}';

        const result = await useCase.execute(output, contract);

        expect(result.isValid).toBe(true);
        expect(result.parsedData).toEqual({ success: true });
    });

    it('should handle invalid JSON in default behavior', async () => {
        const useCase = new ValidateAgentOutputUseCase(undefined as any);
        const contract: OutputContract = { format: 'json' };
        const output = 'invalid json';

        const result = await useCase.execute(output, contract);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toBeDefined();
    });

    it('should return invalid for unsupported formats', async () => {
        const useCase = new ValidateAgentOutputUseCase(undefined as any);
        const contract: OutputContract = { format: 'unsupported' as any };
        const output = '...';

        const result = await useCase.execute(output, contract);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toContain('Unsupported format');
    });
});