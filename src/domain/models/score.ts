import { OutputContract } from './promptFacet.js';

export interface Rule {
    condition: {
        field: string;
        operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
        value: any;
    };
    next: string;
}

export interface Passage {
    name: string;
    displayName: string;
    skill: string;
    skills?: string[]; // 並列実行用のスキルリスト（オプション）
    next?: string; // 固定の遷移先（オプション）
    rules?: Rule[]; // 動的分岐ルール（オプション）
    
    // Faceted Prompting fields
    persona?: string;
    policies?: string[];
    knowledge?: string[];
    outputContract?: OutputContract;
}

export interface Score {
    name: string;
    description: string;
    initialPassage: string;
    passages: Passage[];
}

export interface ScoreResult {
    status: 'success' | 'failure' | 'stalled';
    finalPassage?: string;
    error?: string;
}
