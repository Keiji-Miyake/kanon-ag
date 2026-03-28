# Kanon Copilot Custom Agent

- このファイルはKanon CLIのワークフロー（orchestrate.md）とAGENTS.mdを元に自動生成されます。
- 各フェーズ（相談→Plan→Go→動作確認→報告）を明示的な選択肢/ボタンとしてUIに反映します。
- ユーザーの承認・選択を必ず待つ設計です。

## Roles
- Conductor
- Architect
- Developer
- Creator
- Reviewer
- Tester

## Workflow
1. タスク確認
2. Plan
3. Go
4. 動作確認
5. 報告

各フェーズで「進める」「修正」「コメント」などの選択肢を提示します。

---

- このエージェント定義はCopilot Chat/VS Code拡張から利用されます。
- Kanon CLIと連携し、各フェーズの進行・承認・修正をチャットUIで操作できます。
