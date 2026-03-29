# 実装計画: Score & Passage 構造の基礎導入

## Phase 1: データモデルと判定ロジックの設計 (Red/Green TDD) [checkpoint: f887ec1]
- [x] Task: Passage の結果（JSON）を解析し、`next_passage` を決定する `RuleEngine` サービスのテストを作成する [f7d2bce]
- [x] Task: `RuleEngine` サービスを実装し、テストをパスさせる [f7d2bce]
- [x] Task: 各 Passage の出力ハッシュを管理し、3回連続の同一ハッシュを検知する `LoopWatchdog` サービスのテストを作成する [b0833fc]
- [x] Task: `LoopWatchdog` サービスを実装し、テストをパスさせる [b0833fc]
- [x] Task: Conductor - User Manual Verification 'データモデルと判定ロジックの設計' (Protocol in workflow.md)

## Phase 2: Score エンジンの統合と実行 [checkpoint: e9ce76e]
- [x] Task: `score.json` を読み込み、`RuleEngine` に基づいて Passages を動的に遷移させる `ScoreExecutor` のプロトタイプを実装する [4815295]
- [x] Task: `orchestrate.ts` を拡張し、従来の `pipeline.json` に加えて `ScoreExecutor` による実行をサポートする [177eb32]
- [x] Task: エージェントが返す JSON コードブロック (`json:passage-result`) を抽出・パースする機能を実装し、遷移判定に連携する [177eb32]
- [x] Task: Conductor - User Manual Verification 'Score エンジンの統合と実行' (Protocol in workflow.md)
