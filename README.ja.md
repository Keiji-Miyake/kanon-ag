# 🌌 Kanon — 自律型AIオーケストレーションCLI

[English](./README.md)

Kanonは、複数のAIエージェント（Gemini、OpenCode-ai、GitHub Copilot）を統合し、ソフトウェア開発のライフサイクル全体を自律的に進行させる次世代オーケストレーションツールです。

## ✨ 主な特徴

- **マルチエージェント連携**: Architect → Developer → Reviewer の3段階パイプライン
- **自律ゲートキーピング**: 生成コードを自動検証（Lint/Build）し、エラー時は自律修正ループを実行
- **`kanon-cli.json` 設定**: プロジェクトごとにエージェント割り当て・worktreeパス・リトライ回数をカスタマイズ
- **Antigravity ダッシュボード**: VS Codeサイドバー + WebSocketによるリアルタイムモニタリング
- **クリーンアーキテクチャ**: FSMベースのドメイン設計とユースケース層による高い保守性

## 🚀 クイックスタート

### インストール

```bash
npm install
npm run build:cli
npm link   # kanon コマンドをグローバルに使えるようにする
```

### タスクを実行する

```bash
# 実装計画を策定する
kanon plan --task="ユーザー認証をAPIに追加する"

# 計画を実行する（自律レビュー・修正ループあり）
kanon execute

# 最終レビューを実行する
kanon review
```

### ダッシュボードを起動する（VS Code）

```bash
kanon ui   # WebSocketサーバーをポート3001で起動
```

VS Codeのサイドバーにある 🚀 アイコンをクリックしてAntigravityダッシュボードを開きます。

## ⚙️ 設定ファイル（`.kanon/config.json`）

Kanonのプロジェクト初期化（`kanon init`）時に `.kanon/config.json` が生成されます。
ここで各エージェントのCLI割り当て、モデルの指定、およびKanonの動作をカスタマイズできます。

```json
{
  "defaultCli": "gemini",
  "agents": {
    "architect": {
      "command": "gemini",
      "model": "gemini-3.1-pro"
    },
    "developer": {
      "command": "opencode",
      "model": "claude-4.6-opus"
    },
    "reviewer": {
      "command": "copilot",
      "model": "gpt-5.3-codex"
    }
  },
  "worktreeDir": "worktree",
  "maxRetries": 3
}
```

| フィールド | 説明 | デフォルト |
|---|---|---|
| `defaultCli` | デフォルトで使用するAIコマンド CLI（例: `gemini`, `copilot`, `opencode`） | `"gemini"` |
| `agents.*.command` | 特定のエージェント役割ごとのCLI割り当て | (`defaultCli` を使用) |
| `agents.*.model` | そのエージェントに渡すLLMモデル名（各コマンドの `--model` として使用） | - |
| `worktreeDir` | タスクごとに git worktree を作成するディレクトリ | `"worktree"` |
| `maxRetries` | 自律修正ループ（Gatekeeperレビュー失敗時）の最大リトライ回数 | `3` |

> ℹ️ **旧形式との互換性**: プロジェクトルートに置かれた `kanon-cli.json` や `.kanonrc` も引き続き読み込まれますが、`.kanon/config.json` が存在する場合はそちらが最優先で採用されます。

**VS Code エディタ補完用スキーマ**：
VS Codeで編集する際に入力補完（サジェスト）などのサポートを受けたい場合のみ、用意されている [`kanon-config.schema.json`](./kanon-config.schema.json) を参照してください。（このJSON自体はKanonの動きに影響を与えません）

## 🧪 テスト

```bash
# ユニットテスト（Domain / Use Cases / Infrastructure 層）
npm run test:unit

# ビルド検証
npm run build:cli
```

Vitestを使用した56件のテストケースが7つのテストファイルにあります。詳細は [`docs/TESTING.md`](./docs/TESTING.md) を参照してください。

## 🏗️ プロジェクト構成

```
src/
├── cli/                    # CLIエントリポイント、エージェントランナー、設定ローダー
│   ├── orchestrate.ts      # kanon コマンド本体
│   ├── cli-resolver.ts     # CLI検出・設定読み込み（kanon-cli.json対応）
│   └── prompts/            # LLMプロンプトテンプレート
├── domain/                 # 純粋なビジネスロジック（外部依存なし）
│   ├── models/             # FSMノード・エージェント状態・フィードバック・プロンプトファセット
│   └── services/           # MergeGateway（all/any集約条件）
├── usecases/               # オーケストレーション・プロンプトユースケース
│   ├── orchestration/      # TransitionEngine、ReviewOrchestrator
│   └── prompt/             # PromptSynthesizer、FeedbackInjector
└── infrastructure/         # 外部連携実装
    ├── config/             # YamlWorkflowParser
    └── contextBus/         # InMemoryBlackboard
tests/                      # Vitestユニットテスト（src/ と同じ階層構成）
skills/                     # エージェントスキル定義（SKILL.mdファイル）
docs/                       # アーキテクチャドキュメント・TODO・テストガイド
```

## 📚 ドキュメント

- [アーキテクチャ](./docs/ARCHITECTURE.md)
- [テスト戦略](./docs/TESTING.md)
- [TODO / ロードマップ](./docs/TODO.md)
- [はじめる](./docs/GET_STARTED.ja.md)
- [コントリビューション](./CONTRIBUTING.ja.md)

## 📝 ライセンス

MIT — 詳細は [LICENSE](./LICENSE) を参照してください。
