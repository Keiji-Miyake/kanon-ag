export interface Passage {
    name: string;
    displayName: string;
    skill: string;
    skills?: string[]; // 並列実行用のスキルリスト（オプション）
    next?: string; // 固定の遷移先（オプション）
    
    // Faceted Prompting fields
    persona?: string;
    policies?: string[];
    knowledge?: string[];
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
