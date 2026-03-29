export interface Persona {
    role: string;
    description: string;
    expertise: string[];
}

export interface Policy {
    rules: string[];
    constraints: string[];
    qualityCriteria: string[];
}

export interface Instruction {
    objective: string;
    tasks: string[];
}

export interface Knowledge {
    context: string;
    architectureRules?: string;
    relatedFiles?: string[];
}

export interface OutputContract {
    format: 'json' | 'markdown' | 'text' | 'diff' | string;
    schema?: any; // 該当する場合はJSON Schema
    example?: string;
}

export interface FacetedPrompt {
    persona: Persona;
    policy: Policy;
    instruction: Instruction;
    knowledge: Knowledge;
    outputContract: OutputContract;
}

// 追加分
export type FacetType = 'persona' | 'policy' | 'knowledge' | 'instruction';

export interface PromptFacet {
    name: string;
    type: FacetType;
    content: string;
}

export interface PromptBlueprint {
    persona?: string;
    policies?: string[];
    knowledge?: string[];
    instruction?: string;
}
