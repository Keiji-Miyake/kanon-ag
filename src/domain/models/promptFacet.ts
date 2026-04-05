import { ValidationResult as DetailedValidationResult } from './validation.js';

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

export type OutputFormat = 'json' | 'markdown' | 'text' | 'diff' | string;

export interface OutputContract {
    format: OutputFormat;
    schema?: Record<string, unknown>; // JSON Schema定義 (format: 'json' の場合必須)
    example?: string;
}

// TODO: 後で完全に `./validation.js` に移行する
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    parsedData?: unknown; // パースに成功したJSONデータ等
}

export interface FacetedPrompt {
    persona: Persona;
    policy: Policy;
    instruction: Instruction;
    knowledge: Knowledge;
    outputContract: OutputContract;
}

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
    outputContract?: OutputContract;
}
