# 実装計画: Consensus (MAGI方式) の導入

## Phase 1: 並列実行基盤と出力収集 (Red/Green TDD) [checkpoint: da5883b]
- [x] Task: `Passage` モデルを `skills: string[]` に対応させ、`ScoreExecutor` で並列 Passage を検知できるようにする [d899508]
- [x] Task: 複数のエージェントを並列に Spawner で起動し、全ての出力を配列として収集する `ParallelRunner` サービスのテストを作成する [d899508]
- [x] Task: `ParallelRunner` サービスを実装し、テストをパスさせる [d899508]
- [x] Task: Conductor - User Manual Verification '並列実行基盤と出力収集' (Protocol in workflow.md)

## Phase 2: ConsensusService (LLM集計) と再審議ループ [checkpoint: 561ccd1]
- [x] Task: 複数エージェントの出力を統合し、Supervisor 向けの集計プロンプトを構築する `ConsensusService` のテストを作成する [561ccd1]
- [x] Task: `ConsensusService` を実装し、Supervisor エージェントによる判定ロジックを統合する [561ccd1]
- [x] Task: 合議不一致時に、各エージェントに他者の意見をフィードバックして再審議させるループ制御を `orchestrate.ts` に実装する [561ccd1]
- [x] Task: Conductor - User Manual Verification 'ConsensusService と再審議ループ' (Protocol in workflow.md)
