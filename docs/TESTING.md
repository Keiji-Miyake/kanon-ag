# Testing Strategy (テスト戦略)

`kanon-ag` プロジェクトのテスト戦略と実行方法について説明します。

## ユニットテスト

`src/` 配下の Domain / Use Cases / Infrastructure 層に対して、**Vitest** を使ったユニットテストを提供しています。

### テストファイルの構成

```tree
tests/
├── cli/
│   ├── configLoader.test.ts            # 設定ファイルローダーの検証
│   └── orchestration.e2e.test.ts       # オーケストレーション E2E テスト
├── domain/
│   └── services/
│       └── mergeGateway.test.ts        # MergeGateway (all/any 条件の集約ロジック)
├── usecases/
│   ├── prompt/
│   │   ├── promptSynthesizer.test.ts   # プロンプト合成・Recency Effect の検証
│   │   └── feedbackInjector.test.ts    # フィードバック注入ロジックの検証
│   └── orchestration/
│       └── transitionEngine.test.ts    # FSM 状態遷移ロジックの検証
└── infrastructure/
    └── config/
        └── yamlWorkflowParser.test.ts  # YAML ワークフロー定義パーサーの検証
```

### 実行方法

```bash
# ユニットテストを実行する
npm run test:unit

# テストを watch モードで実行する（開発時）
npx vitest

# ビルドすることで TypeScript の型チェックを行う
npm run build:cli
```

### テストカバレッジ

| コンポーネント | テストケース数 | カバーする観点 |
|---|---|---|
| `ConfigLoader` | 15 | 設定ファイルの読み込み・マージ・デフォルト値 |
| `MergeGateway` | 9 | all/any の境界条件、未定義タイプのエラー処理 |
| `PromptSynthesizer` | 8 | 全ファセット統合、Recency Effect |
| `FeedbackInjector` | 8 | Issue 注入、イミュータビリティ |
| `TransitionEngine` | 9 | 状態遷移、終端ノード、アクション取得 |
| `YamlWorkflowParser` | 6 | 正常系・省略フィールド・異常系 |
| `Orchestration E2E` | 1 | 修正ループとマージの統合テスト |

**合計: 7ファイル / 56テストケース**
