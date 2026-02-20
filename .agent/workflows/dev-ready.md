---
description: 開発開始前の準備チェック - 作業履歴・タスク・ToDoを確認し、次のアクションを提案
---

# Dev Ready - 開発開始前チェック

作業セッション開始時に以下のステップを実行し、現状を把握した上で次のアクションを提案します。

---

## 1. Gitステータスの確認

// turbo
```bash
git status
```

- 未コミットの変更があるか確認
- 現在のブランチを確認

---

## 2. 直近のコミット履歴の確認

// turbo
```bash
git log --oneline -10
```

- 最近の作業内容を把握

---

## 3. プロジェクトルートのドキュメント確認

以下のファイルが存在する場合は内容を確認：

### タスク・進捗管理
- `TASKS.md` / `TASK.md` - タスク一覧
- `TODO.md` / `TODO` - 未完了のToDo
- `ROADMAP.md` - ロードマップ・マイルストーン
- `BACKLOG.md` - バックログ

### プロジェクト情報
- `CHANGELOG.md` / `HISTORY.md` - 変更履歴（直近のエントリを確認）
- `README.md` - プロジェクト概要
- `CONTRIBUTING.md` - コントリビューションガイド
- `DEVELOPMENT.md` / `DEVELOPER.md` - 開発者向けドキュメント

### エージェント・AI関連
- `AGENTS.md` / `AGENT.md` - エージェント指示
- `.agent/` - エージェント設定ディレクトリ
- `.cursor/rules/` - Cursorルール
- `.github/copilot-instructions.md` - GitHub Copilot指示

---

## 4. docs/ ディレクトリの確認

`docs/` ディレクトリが存在する場合：

// turbo
```bash
find docs/ -name "*.md" -type f 2>/dev/null | head -20
```

### 特に確認すべきファイル
- `docs/README.md` - ドキュメントの概要
- `docs/CONTEXT.md` - コンテキスト・背景情報
- `docs/ARCHITECTURE.md` - アーキテクチャ設計
- `docs/ADR/` - Architecture Decision Records
- `docs/dev/` - 開発者向けドキュメント（feature別進捗など）
- `docs/api/` - API仕様
- `docs/design/` - 設計ドキュメント

---

## 5. GitHub/GitLab関連の確認

// turbo
```bash
ls -la .github/ 2>/dev/null || echo "No .github directory"
```

### 確認項目
- `.github/ISSUE_TEMPLATE/` - 未対応のイシューテンプレート
- `.github/workflows/` - CI/CDワークフロー状態
- `.gitlab/` - GitLab固有の設定

---

## 6. 会話履歴と知識項目(KI)の確認

- 直近の会話サマリーを確認（提供されている場合）
- 関連するKIがあれば内容を確認
- 前回の作業状態を把握

---

## 7. `.gemini/brain/` 内の作業ログ確認

前回の会話で作成されたアーティファクトがあれば確認：

- `task.md` - 前回のタスクチェックリスト
- `implementation_plan.md` - 実装計画
- `walkthrough.md` - 作業の振り返り

---

## 8. Feature/Skills別の進捗確認

プロジェクト特有のディレクトリ構造を確認：

// turbo
```bash
find . -name "CONTEXT.md" -o -name "SPEC.md" -o -name "STATUS.md" -o -name "PROGRESS.md" 2>/dev/null | grep -v node_modules | head -10
```

### 一般的なパターン
- `features/*/README.md` - 機能別ドキュメント
- `packages/*/CHANGELOG.md` - パッケージ別変更履歴
- `skills/*/CONTEXT.md` - スキル別コンテキスト
- `modules/*/STATUS.md` - モジュール別ステータス

---

## 9. 現状のサマリーと提案

上記の情報を総合して、以下を報告：

### 報告内容

1. **現在の状態**
   - 未完了のタスク
   - 未コミットの変更
   - 前回の作業のコンテキスト
   - CHANGELOGの最新エントリ（Unreleasedセクション含む）

2. **次のアクション候補**
   - 優先度の高いタスク
   - 継続すべき作業
   - 新規で取り組むべき項目

3. **確認事項**（あれば）
   - ユーザーへの質問
   - 優先順位の確認

---

## 注意事項

- ユーザーが特に指示しない限り、確認のみを行い自動的に作業を開始しない
- 複数の選択肢がある場合はリスト形式で提示し、ユーザーに選択を促す
- 前回の作業が未完了の場合は、継続するか新規タスクに切り替えるか確認する
