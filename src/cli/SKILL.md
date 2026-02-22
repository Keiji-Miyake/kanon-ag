---
name: orchestrator
description: Kanonによる自律型マルチエージェント・オーケストレーション。Gemini (Architect), OpenCode (Developer), Copilot (Reviewer) を統合し、VS Code 拡張機能 (Antigravity) と連携してリアルタイムにログをストリーミングします。
license: MIT License
metadata:
  author: Kanon Team
  version: "3.0-prototype"
---

# Kanon Orchestrator - Autonomous Software Factory

Kanonは、複数のAIエージェントを指揮してソフトウェア開発を自動化するオーケストレーターです。

## 🌟 アーキテクチャ

Kanonは独自の3段階Tierシステムを採用しています：

1.  **Tier 1: Architect (Gemini)**
    - タスクの全体像を把握し、詳細な `implementation_plan.md` を作成。
2.  **Tier 2: Developer (OpenCode-ai)**
    - 計画に基づいた実装を実行。Lint/Buildエラー時は Antigravity ゲートキーパーと協力して自律修正。
3.  **Tier 3: Reviewer (GitHub Copilot)**
    - 完成したコードをセキュリティと設計の両面からレビュー。

## 🖥️ Antigravity UI 集成

Kanon の最大の特徴は、VS Code 拡張機能「Antigravity」との強力な連携です。

- **リアルタイム・テレメトリ**: エージェントの思考ログを WebSocket で VS Code サイドバーにストリーミング。
- **ゲートキーパー可視化**: 自動検証のプロセスと結果をダッシュボードに表示。

## 🛠️ 主要スクリプト

- `orchestrate.ts`: CLIコマンド（plan, execute, review, ui）の本体。
- `extension.ts`: VS Code 拡張機能のエントリポイント。

## 🚀 使い方

### CLI版
詳細はルートディレクトリの [README.ja.md](../../README.ja.md) を参照してください。

### Antigravity拡張機能版
Antigravityのチャットで `/orchestrate` と入力すると、自律開発パイプラインが起動します。
タスクを指定すると、計画→実装→検証→レビューの全フェーズが自動的に進行します。

