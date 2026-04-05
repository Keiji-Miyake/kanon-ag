export interface ValidationError {
    path: string; // エラーが発生したフィールドパス (e.g., ".result.status")
    message: string; // エラーメッセージ
    keyword?: string; // バリデーションエラーの識別子 (e.g., "required", "type", "enum")
    params?: Record<string, unknown>; // エラーの詳細パラメータ
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    parsedData?: unknown; // パースに成功したデータ等
}
