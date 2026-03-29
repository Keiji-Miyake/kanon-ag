import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptAssembler } from '../../../src/domain/services/promptAssembler.js';
import { PromptBlueprint } from '../../../src/domain/models/promptFacet.js';
import * as fs from 'fs';

vi.mock('fs');

describe('PromptAssembler', () => {
    const assembler = new PromptAssembler('/mock/facets');

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('Blueprint に基づいて各ファセットを結合できること', async () => {
        const blueprint: PromptBlueprint = {
            persona: 'architect',
            policies: ['coding-standard'],
            knowledge: ['project-structure'],
            instruction: 'Implement feature X'
        };

        // Mock fs.readFileSync
        vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
            if (path.includes('persona/architect.md')) return 'Persona: Architect';
            if (path.includes('policy/coding-standard.md')) return 'Policy: Coding Standard';
            if (path.includes('knowledge/project-structure.md')) return 'Knowledge: Project Structure';
            return '';
        });
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const prompt = await assembler.assemble(blueprint);

        expect(prompt).toContain('Persona: Architect');
        expect(prompt).toContain('Policy: Coding Standard');
        expect(prompt).toContain('Knowledge: Project Structure');
        expect(prompt).toContain('Implement feature X');
    });

    it('存在しないファセットは無視されるかエラーを投げないこと', async () => {
        const blueprint: PromptBlueprint = {
            persona: 'non-existent'
        };

        vi.mocked(fs.existsSync).mockReturnValue(false);

        const prompt = await assembler.assemble(blueprint);
        expect(prompt.trim()).toBe('');
    });
});
