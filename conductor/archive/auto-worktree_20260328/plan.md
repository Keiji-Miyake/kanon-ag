# 実装計画: ワークツリー自動管理機能

## Phase 1: ワークツリー管理サービスの強化 (Red/Green TDD) [checkpoint: 1bdc422]
- [x] Task: `LocalGitSandbox` を拡張し、ブランチ名サニタイズやベースパス指定に対応する [d0c4d0b]
- [x] Task: ワークツリーの作成・マージ・削除のライフサイクルを管理する `WorktreeOrchestrator` のテストを作成する [d0c4d0b]
- [x] Task: `WorktreeOrchestrator` を実装し、テストをパスさせる [d0c4d0b]
- [x] Task: Conductor - User Manual Verification 'ワークツリー管理サービスの強化' (Protocol in workflow.md)

## Phase 2: Score エンジンへの統合 [checkpoint: 6b9cbdd]
- [x] Task: `orchestrate.ts` を更新し、`runScore` 開始時に `WorktreeOrchestrator` を呼び出してサンドボックスを準備するように変更する [6b9cbdd]
- [x] Task: 各 Passage 実行時の `cwd` をワークツリーのパスに自動的に切り替えるロジックを実装する [6b9cbdd]
- [x] Task: 実行完了後の自動マージおよびクリーンアップ処理を統合する [6b9cbdd]
- [~] Task: Conductor - User Manual Verification 'Score エンジンへの統合' (Protocol in workflow.md)
