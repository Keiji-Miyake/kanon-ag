# Agent Development Guidelines

## プロジェクトの目的

**Kanon** は、複数のAIエージェント（Gemini, OpenCode-ai, GitHub Copilot 等）を統合し、ソフトウェア開発ライフサイクル全体（計画 → 実装 → レビュー）を自律的に遂行するオーケストレーションCLIです。
有限オートマトン（FSM）に基づく**決定論的ルーティング**と、**Faceted Prompting** によるプロンプト合成を核心技術としています。

## 技術スタック (Tech Stack)

- **Runtime**: Node.js (v18+)
- **Language**: TypeScript (ESM)
- **Package Manager**: npm
- **Test Runner**: [Vitest](https://vitest.dev) (v4)
- **Architecture**: DDD / Clean Architecture

## プロジェクト構成

```tree
src/
├── cli/                    # CLIエントリポイント、エージェントランナー、設定ローダー
│   ├── orchestrate.ts      # kanon コマンド本体
│   ├── cli-resolver.ts     # CLI検出・設定読み込み
│   └── prompts/            # LLMプロンプトテンプレート
├── domain/                 # 純粋なビジネスロジック（外部依存なし）
│   ├── models/             # FSMノード・エージェント状態・フィードバック・プロンプトファセット
│   ├── repositories/       # Blackboard・Sandbox インターフェース
│   └── services/           # MergeGateway（all/any集約条件）
├── usecases/               # アプリケーションユースケース
│   ├── orchestration/      # TransitionEngine、ReviewOrchestrator
│   ├── prompt/             # PromptSynthesizer、FeedbackInjector
│   └── environment/        # WorktreeManager
├── infrastructure/         # 外部連携実装
│   ├── config/             # YamlWorkflowParser
│   ├── contextBus/         # InMemoryBlackboard, RedisBlackboard
│   └── git/                # LocalGitSandbox
└── extension/              # VS Code拡張機能（Antigravity Dashboard）
tests/                      # Vitestユニットテスト（src/ と同じ階層構成）
skills/                     # エージェントスキル定義（SKILL.mdファイル）
demo/                       # デモ・E2Eテスト用プロジェクト
docs/                       # アーキテクチャドキュメント
```

## 開発原則 (Development Principles)

### 1. クリーンアーキテクチャの遵守

- `domain/` 層は外部依存を持たない純粋なビジネスロジックとして実装する。
- `usecases/` 層はアプリケーション固有のオーケストレーションロジックを担当する。
- `infrastructure/` 層が外部システム（Git, LLM, Redis等）との連携を実装する。

### 2. 環境非依存 (Environment Agnostic)

- ファイルパスは常にプロジェクトルートからの相対パスを使用する。
- ユーザーの環境（OS、ユーザー名）に依存する絶対パスを含めないこと。

### 3. ドキュメント駆動 (Document-Driven)

- 実装の前に、必ず設計や変更計画を作成・更新する。
- 変更内容はリリース時に `CHANGELOG.md` に反映する。

### 4. AIレビューと品質保証 (AI Review & QA)

- **「自分以外の」AI** によるレビューを想定し、客観的に理解しやすいコードとドキュメントを書く。
- コミット前には必ずビルドとテストを通すこと。

## 開発ルール (Development Rules)

### ビルドとテスト

```bash
# CLIのビルド
npm run build:cli

# VS Code拡張機能のビルド
npm run build:extension

# 全体ビルド
npm run build

# ユニットテスト（7ファイル, 56テストケース）
npm run test:unit
```

### スキルの作成・修正

- 全てのカスタムスキルは **`skills/`** ディレクトリ以下で管理する。
- `.agent/skills/`, `.gemini/skills/` などの自動生成ディレクトリを直接編集しない。

### Git Worktree の使用

- タスクを開始する際は、必ず `git worktree` を使用して作業ディレクトリをプロジェクトの1つ上の階層に作成し、そこで作業を行う。
- ブランチ名は [Conventional Commits](https://www.conventionalcommits.org/) の形式に従い、ディレクトリ名はブランチ名からプレフィックス（feat/ など）を除いたものにする。
- 作成コマンド例: `git worktree add ../<branch-name-without-prefix> -b <feature-branch-name> main`
  - (例: `git worktree add ../multi-agent-chat-ui -b feat/multi-agent-chat-ui main`)
- メインの作業ツリーを直接変更することは避ける。

### コミットメッセージ

- [Conventional Commits](https://www.conventionalcommits.org/) に従う。
  - `feat`: 新機能
  - `fix`: バグ修正
  - `docs`: ドキュメントのみの変更
  - `refactor`: 機能追加やバグ修正を含まないコード変更
  - `chore`: ビルドプロセスや補助ツールの変更

## 関連ドキュメント

- [アーキテクチャ](./docs/ARCHITECTURE.md)
- [はじめる](./docs/GET_STARTED.ja.md)
- [コントリビューション](./CONTRIBUTING.ja.md)
- [README (日本語)](./README.ja.md)
