---
trigger: always_on
---

# General Rules

## 日本語出力の強制 (Japanese Output Enforcement)

エージェントが生成する全てのアーティファクトおよびサマリーは日本語で出力してください。

- `task.md` の項目、ステータス、サマリーを日本語で記述してください。
- `implementation_plan.md` の目標説明、変更内容、検証計画を全て日本語で記述してください。
- `walkthrough.md` の実施内容、検証結果を全て日本語で記述してください。
- `task_boundary` ツールの `TaskSummary` と `TaskStatus` も日本語で記述してください。
- ユーザーへの通知（`notify_user`）も日本語で行ってください。

## スキル管理の安全性 (Skill Management Safety)

エージェントは、システムの整合性を保つために以下のディレクトリを直接編集してはいけません。

- `.agent/skills/`: インストール済みスキルの格納場所。
- `.agents/skills/`: （旧構成）同上。

自作スキルの開発・修正は、必ずプロジェクトルートの `./skills/` ディレクトリ内で行ってください。

## Git Worktree の使用強制 (Enforce Git Worktree Usage)

タスクを開始する際は、必ず `git worktree` を使用して作業ディレクトリをプロジェクトの1つ上の階層に作成し、そこで作業を行ってください。
ブランチ名は [Conventional Commits](https://www.conventionalcommits.org/) の形式に従い、ディレクトリ名はブランチ名からプレフィックス（feat/ など）を除いたものにしてください。

作成コマンド例:
`git worktree add ../<branch-name-without-prefix> -b <feature-branch-name> main`
(例: `git worktree add ../multi-agent-chat-ui -b feat/multi-agent-chat-ui main`)

メインの作業ツリーを直接変更することは避けてください。
