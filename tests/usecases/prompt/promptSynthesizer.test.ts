import { describe, it, expect } from 'vitest';
import { PromptSynthesizer } from '../../../src/usecases/prompt/synthesizer.js';
import { FacetedPrompt } from '../../../src/domain/models/promptFacet.js';

describe('PromptSynthesizer', () => {
    const synthesizer = new PromptSynthesizer();

    // テスト用の完全なファセット
    const baseFacet: FacetedPrompt = {
        persona: {
            role: 'Expert Developer',
            description: 'テスト用の開発者ロール',
            expertise: ['TypeScript', 'Node.js'],
        },
        knowledge: {
            context: 'Kanon FSMオーケストレーション環境で動作しています。',
            architectureRules: 'DDD/Clean Architectureに準拠すること。',
            relatedFiles: ['src/domain/models/agentState.ts'],
        },
        instruction: {
            objective: 'コアシステムのテストを実装する',
            tasks: ['Vitestをセットアップする', 'ユニットテストを書く'],
        },
        outputContract: {
            format: 'markdown',
            example: '## 実装結果\n- ...',
        },
        policy: {
            rules: ['破壊的なコマンドを実行しないこと'],
            constraints: ['既存のAPIを変更しないこと'],
            qualityCriteria: ['TypeScript の型エラーをゼロにすること'],
        },
    };

    it('全ての構成要素（Persona, Knowledge, Instruction, OutputContract, Policy）を含む', () => {
        const result = synthesizer.synthesize(baseFacet);
        expect(result).toContain('[Role: Expert Developer]');
        expect(result).toContain('[Context & Knowledge]');
        expect(result).toContain('[Objective]');
        expect(result).toContain('[Output Format]');
        expect(result).toContain('[CRITICAL POLICY & CONSTRAINTS]');
    });

    it('Recency Effect: Policy セクションがプロンプトの末尾に配置されている', () => {
        const result = synthesizer.synthesize(baseFacet);
        const policyIndex = result.lastIndexOf('[CRITICAL POLICY & CONSTRAINTS]');
        const outputIndex = result.indexOf('[Output Format]');
        const instructionIndex = result.indexOf('[Objective]');
        // Policy が OutputContract・Instruction より後ろにあること
        expect(policyIndex).toBeGreaterThan(outputIndex);
        expect(policyIndex).toBeGreaterThan(instructionIndex);
        // Policy がプロンプト全体の最後の主要セクションであること
        expect(result.trimEnd().endsWith('TypeScript の型エラーをゼロにすること')).toBe(true);
    });

    it('Persona の role と description を正しく含む', () => {
        const result = synthesizer.synthesize(baseFacet);
        expect(result).toContain('Expert Developer');
        expect(result).toContain('テスト用の開発者ロール');
        expect(result).toContain('TypeScript, Node.js');
    });

    it('Knowledge の relatedFiles が存在する場合、正しく含まれる', () => {
        const result = synthesizer.synthesize(baseFacet);
        expect(result).toContain('src/domain/models/agentState.ts');
    });

    it('Knowledge の relatedFiles が空の場合、Related Files セクションを含まない', () => {
        const facetNoFiles: FacetedPrompt = {
            ...baseFacet,
            knowledge: { context: 'シンプルなコンテキスト' },
        };
        const result = synthesizer.synthesize(facetNoFiles);
        expect(result).not.toContain('Related Files');
    });

    it('Instruction の objective と tasks を正しく含む', () => {
        const result = synthesizer.synthesize(baseFacet);
        expect(result).toContain('コアシステムのテストを実装する');
        expect(result).toContain('1. Vitestをセットアップする');
        expect(result).toContain('2. ユニットテストを書く');
    });

    it('Policy の rules, constraints, qualityCriteria を正しく含む', () => {
        const result = synthesizer.synthesize(baseFacet);
        expect(result).toContain('破壊的なコマンドを実行しないこと');
        expect(result).toContain('既存のAPIを変更しないこと');
        expect(result).toContain('TypeScript の型エラーをゼロにすること');
    });

    it('セクション間が "---" 区切り文字で結合される', () => {
        const result = synthesizer.synthesize(baseFacet);
        expect(result).toContain('---');
    });
});
