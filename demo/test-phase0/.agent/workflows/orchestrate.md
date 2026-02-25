---
description: Kanonオーケストレーション - 複数AIエージェントによる自律開発パイプライン実行
---

# /orchestrate - 自律開発パイプライン

ユーザーからタスクを受け取り、Antigravity (Conductor) として振る舞う `kanon` CLI が、全行程を自律的に進行させます。

// turbo-all

---

## 0. タスクの確認

ユーザーにタスクの内容を確認します。まだタスクが指定されていない場合は、ユーザーに入力を求めてください。

タスクが確定したら、以下の情報を収集してください：

- タスク内容（何を作るか / 何を修正するか）

---

## 1. Antigravity Global Orchestration

`kanon run` コマンドを実行して、計画(Architect)・実装(Developer)・レビュー(Reviewer) の全工程を一括で実行します。
Zero Approval対応済みのため、ユーザーの承認や追加指示は不要です。完了まで自律的に動作します。

```bash
kanon run --task="{{TASK}}"
```

---

## 完了報告

実行が完了したら、Dashboardでログを確認するか、生成された成果物を確認するようユーザーに促してください。
