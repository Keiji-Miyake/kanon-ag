# Advanced Validation & Workflow Rules 詳細設計

## 1. 概要
本ドキュメントは、Kanon AGにおける出力の高度なバリデーション（Advanced Validation）と、エージェントの出力結果に基づく動的なワークフロー分岐（Workflow Rules）の詳細設計を定義する。
本設計はクリーンアーキテクチャの原則に従い、ドメイン層、ユースケース層、インフラストラクチャ層の各責務を分離して実装する。

## 2. Advanced Validation (高度なバリデーション)
現在の出力検証メカニズムを拡張し、`ajv` (Another JSON Schema Validator) を導入して、`outputContract.schema` に基づいた厳格な JSON Schema 検証を実装する。

### 2.1 アーキテクチャ設計

*   **Domain 層 (`src/domain/`)**:
    *   `OutputContract` エンティティ: スキーマ定義を保持する。
    *   `ValidationError` エンティティ/値オブジェクト: バリデーション失敗時の詳細情報（フィールドパス、エラーメッセージ等）をカプセル化する。
    *   `IOutputValidator` インターフェース: 出力データと `OutputContract` を受け取り、検証結果を返すインターフェースを定義。
*   **UseCase 層 (`src/usecases/`)**:
    *   `ValidateAgentOutputUseCase`: エージェントの出力を取得し、`IOutputValidator` を用いて検証を実行する。検証失敗時は、リトライ処理などの制御を行う。
*   **Infrastructure 層 (`src/infrastructure/`)**:
    *   `AjvOutputValidator`: `IOutputValidator` の実装。`ajv` ライブラリを使用して、実際の JSON Schema 検証処理を実装する。

### 2.2 実装の詳細

1.  **パッケージ導入**:
    ```bash
    npm install ajv ajv-formats
    ```
2.  **`AjvOutputValidator` の実装**:
    *   `ajv` インスタンスを生成し、`ajv-formats` を適用する（必要に応じて）。パフォーマンス最適化のため、コンパイルされたスキーマをキャッシュする仕組みを設ける。
    *   `OutputContract.schema` をコンパイルし、エージェント出力の JSON オブジェクトに対して検証を実行する。
    *   検証エラーが発生した場合、`ajv` のエラーオブジェクト（`ajv.errors`）からドメインの `ValidationError` に変換して返す。

## 3. Workflow Rules (Dynamic Branching)
エージェントの出力（特定のフィールドの値）に基づいて、次に実行するステップ（Passage/Pipeline）を動的に決定する条件分岐メカニズムを導入する。

### 3.1 アーキテクチャ設計

*   **Domain 層 (`src/domain/`)**:
    *   `Passage` または `PipelineStep` エンティティの拡張: `rules` プロパティを追加。
        ```typescript
        interface Condition {
          field: string; // 例: "result.status" (ドット記法でネストをサポート)
          operator: "eq" | "neq" | "contains" | "gt" | "lt";
          value: any;    // 例: "needs_review"
        }

        interface Rule {
          condition: Condition;
          nextStep: string; // 条件合致時の遷移先ステップID
        }
        ```
    *   `WorkflowContext`: 現在のワークフローの状態と、これまでのエージェント出力を保持する。
*   **UseCase 層 (`src/usecases/`)**:
    *   `DetermineNextStepUseCase`: 現在のステップの完了後、エージェントの出力データとステップの `rules` を評価し、次のステップIDを決定する。
*   **Infrastructure 層 (`src/infrastructure/`)**:
    *   `score.json` または `pipeline.json` のパーサー拡張: 新たに追加された `rules` フィールドをパースし、ドメインモデルにマッピングする。

### 3.2 評価ロジック (`DetermineNextStepUseCase`)
1.  現在のステップで定義された `rules` を順番に評価する。
2.  `condition.field` をエージェントの出力 JSON から取得する（ユーティリティ関数を用いてドット記法を解決）。
3.  指定された `operator` に基づいて、取得した値と `condition.value` を比較する。
4.  最初に条件に合致したルールの `nextStep` を次の実行ステップとして返す。
5.  どの条件にも合致しない場合は、デフォルトの次ステップ（定義されている場合）、またはワークフローの終了へとフォールバックする。

## 4. サブエージェント連携手順（実装後の完了確認）

実装完了後、以下の手順でサブエージェントにテストとレビューを依頼する。

### 4.1 Tester エージェントへの依頼
`tester` エージェントを起動し、実装したバリデーションと条件分岐のテストを作成・実行させる。

**指示内容 (Prompt Example):**
> @tester
> `Advanced Validation` (`ajv` を用いた `AjvOutputValidator`) と `Workflow Rules` (動的条件分岐) の実装が完了しました。
> 以下のテストケースを作成し、実行してください。
> 1. `AjvOutputValidator` のユニットテスト:
>    - 有効なデータが正しく検証されること。
>    - 無効なデータ（型不一致、必須フィールド欠落など）で適切なエラー（`ValidationError`）が返されること。
>    - スキーマのキャッシュが機能していること。
> 2. `DetermineNextStepUseCase` のユニットテスト:
>    - 様々な条件（`eq`, `neq`, `contains`, ネストされたフィールドへのアクセスなど）が正しく評価されること。
>    - 条件に合致した場合に正しい `nextStep` が返されること。
>    - 条件に合致しない場合のデフォルトの遷移が正しく機能すること。
> 3. テストの実行結果を報告してください。

### 4.2 Reviewer エージェントへの依頼
`reviewer` エージェントを起動し、コードレビューを依頼する。

**指示内容 (Prompt Example):**
> @reviewer
> `Advanced Validation` と `Workflow Rules` の実装およびテストが完了しました。
> `docs/dev/design-advanced-validation-rules.md` の設計に基づいて、以下の観点でコードレビューを実施してください。
> 1. クリーンアーキテクチャの原則（ドメイン、ユースケース、インフラの分離）が守られているか。
> 2. `ajv` の使い方が適切であり、パフォーマンスに問題がないか。
> 3. ワークフロー分岐の条件評価ロジックが堅牢か（存在しないフィールドへのアクセス時のエラーハンドリングなど）。
> 4. テストのカバレッジとケースの妥当性は十分か。
> 発見した問題点や改善提案があれば、フィードバックとしてまとめてください。
