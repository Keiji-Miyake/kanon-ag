# Output Contract Schema and Validator Design

## 1. 概要 (Overview)
エージェントの出力が期待されるフォーマット（JSON、Markdown、Textなど）およびスキーマ（JSON Schema）に準拠しているかを検証する「Output Contract Validator」の設計。

## 2. スキーマ定義 (Schema Definition)
`src/domain/models/promptFacet.ts` 拡張として以下を定義します。

```typescript
export type OutputFormat = 'json' | 'markdown' | 'text';

export interface OutputContract {
    format: OutputFormat;
    schema?: Record<string, unknown>; // JSON Schema定義 (format: 'json' の場合必須)
    example?: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    parsedData?: unknown; // パースに成功したJSONデータ等
}
```

## 3. バリデーター設計 (Validator Design)
`src/domain/services/outputValidator.ts` として実装します。責務は単一とし、入力文字列とOutputContractを受け取って検証結果を返します。

```typescript
export class OutputValidator {
    /**
     * エージェントの出力をContractに基づき検証する
     */
    public validate(output: string, contract: OutputContract): ValidationResult {
        // ...
    }

    private validateJson(output: string, schema?: Record<string, unknown>): ValidationResult {
        // 1. JSONパースの試行
        // 2. schemaが存在すればAjv等を用いたJSON Schema検証
    }

    private validateMarkdown(output: string): ValidationResult {
        // 最小限のMarkdown形式チェック
    }
}
```

## 4. エラーハンドリング
- パースエラー：JSONとしての構造が不正な場合、具体的なエラー位置を返す。
- スキーマエラー：必須プロパティの欠落や型違いをエラーとして列挙する。
- 差し戻し：バリデーションに失敗した場合、FSM（有限オートマトン）により自動的に実装エージェントへ差し戻す指示（FeedbackInjector）にエラー内容を渡す。

## 5. 依存パッケージ
JSON Schemaの検証には、型安全かつ軽量なライブラリ（例: `ajv`）の利用を想定します。
