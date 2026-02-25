import { FacetedPrompt, Persona, Policy, Instruction, Knowledge, OutputContract } from '../../domain/models/promptFacet.js';

export class PromptSynthesizer {
    /**
     * 与えられたファセットから統合されたプロンプト文字列を合成します。
     * Recency Effect を適用し、Policyがプロンプトの最後に確実に配置されるようにします。
     */
    public synthesize(facet: FacetedPrompt): string {
        const parts: string[] = [];

        // 1. Persona (誰が)
        parts.push(this.formatPersona(facet.persona));

        // 2. Knowledge (コンテキスト・前提知識)
        parts.push(this.formatKnowledge(facet.knowledge));

        // 3. Instruction (何を)
        parts.push(this.formatInstruction(facet.instruction));

        // 4. Output Contract (どのように出力するか)
        parts.push(this.formatOutputContract(facet.outputContract));

        // 5. Policy (ルール) - Recency Effect のため必ず最後に配置
        parts.push(this.formatPolicy(facet.policy));

        return parts.join('\n\n---\n\n');
    }

    private formatPersona(persona: Persona): string {
        return `[Role: ${persona.role}]\n${persona.description}\nExpertise: ${persona.expertise.join(', ')}`;
    }

    private formatKnowledge(knowledge: Knowledge): string {
        let text = `[Context & Knowledge]\n${knowledge.context}`;
        if (knowledge.architectureRules) {
            text += `\n\nArchitecture Rules:\n${knowledge.architectureRules}`;
        }
        if (knowledge.relatedFiles && knowledge.relatedFiles.length > 0) {
            text += `\n\nRelated Files:\n${knowledge.relatedFiles.map((f: string) => `- ${f}`).join('\n')}`;
        }
        return text;
    }

    private formatInstruction(instruction: Instruction): string {
        const tasks = instruction.tasks.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n');
        return `[Objective]\n${instruction.objective}\n\n[Tasks]\n${tasks}`;
    }

    private formatOutputContract(contract: OutputContract): string {
        let text = `[Output Format]\nPlease provide your response in ${contract.format} format.`;
        if (contract.schema) {
            text += `\n\nSchema:\n${JSON.stringify(contract.schema, null, 2)}`;
        }
        if (contract.example) {
            text += `\n\nExample:\n${contract.example}`;
        }
        return text;
    }

    private formatPolicy(policy: Policy): string {
        let text = `[CRITICAL POLICY & CONSTRAINTS]\n*You must strictly follow these rules.*`;
        if (policy.rules.length > 0) text += `\n\nRules:\n${policy.rules.map((r: string) => `- ${r}`).join('\n')}`;
        if (policy.constraints.length > 0) text += `\n\nConstraints:\n${policy.constraints.map((c: string) => `- ${c}`).join('\n')}`;
        if (policy.qualityCriteria.length > 0) text += `\n\nQuality Criteria:\n${policy.qualityCriteria.map((q: string) => `- ${q}`).join('\n')}`;
        return text;
    }
}
