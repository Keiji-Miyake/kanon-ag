# Kanon 開発 TODO

Kanon（カノン）オーケストレーションツールの開発ロードマップ・タスク一覧です。

## ✅ Phase 1: ドメイン設計とコア基盤の構築（完了）

純粋なビジネスロジックとドメインモデルを定義します。

- [x] `domain/models/promptFacet.ts` の実装 (5ファセットの型定義)
- [x] `domain/models/agentState.ts`, `feedback.ts` の実装
- [x] `domain/models/fsmNode.ts` の実装 (ノード・エッジの定義)
- [x] `domain/repositories/` 配下の抽象インターフェース定義 (Blackboard, Sandbox)

## ✅ Phase 2: ユースケース層の実装（完了）

決定論的なルーティングとプロンプト制御機能を実装します。

- [x] `usecases/prompt/synthesizer.ts` の実装 (Policy末尾配置ロジック)
- [x] `usecases/prompt/feedbackInjector.ts` の実装 (指摘事項の動的合成)
- [x] `domain/services/mergeGateway.ts` の実装 (all/any集約条件ロジック)
- [x] `usecases/orchestration/transitionEngine.ts` の実装 (FSMに基づく状態遷移)

## ✅ Phase 3: インフラストラクチャ・外部統合と環境サンドボックス（完了）

外部依存（Git, LLM, KV Storeなど）と連携する実装を提供します。

- [x] `infrastructure/git/localGitSandbox.ts` (Git Worktree操作の実装)
- [x] `usecases/environment/worktreeManager.ts` によるタスクごとの隔離環境管理の結合
- [x] `infrastructure/contextBus/inMemoryBlackboard.ts` (共有黒板パターンの実装)
- [x] YAML等でのワークフロー定義読み込み (`yamlWorkflowParser.ts`)

## ✅ Phase 4: エージェントループと並行処理の結合（完了）

複数のエージェントが協調して動作する並行修正ループを完成させます。

- [x] `ReviewOrchestrator` クラスの実装と非同期レビュー実行の基盤
- [x] レビュアーからのフィードバック集約と `MergeGateway` への転送処理
- [x] 差し戻し時の `Instruction` 再生成ループ（自律デバッグループ）のE2E動作保証

## ✅ Phase 5: テスト基盤とUnit Tests（完了）

- [x] Vitestによるコアシステムユニットテスト基盤の構築（49件・全パス）
  - `MergeGateway` / `PromptSynthesizer` / `FeedbackInjector` / `TransitionEngine` / `YamlWorkflowParser` / `ConfigLoader`

## ✅ Phase 6: プロンプト品質強化・設定ファイル機能（完了）

- [x] `plan-task.txt` / `execute-plan.txt` に依存関係・初期化・QAエコシステム構築の指示を追加
- [x] `kanon-cli.json` / `.kanonrc` によるプロジェクト別設定のサポート（`worktreeDir`・`maxRetries`）
- [x] `kanon-config.schema.json` (エディタ補完・バリデーション用 JSON Schema)

## ✅ Phase 7: UI/インテグレーション（完了）

- [x] Antigravity / ダッシュボードUIとの統合の安定化
- [x] CLI (`kanon` コマンド) 経由での新アーキテクチャ版実行の完全サポート
- [x] `redisBlackboard.ts` (Redis を使った分散共有黒板の実装)
- [x] E2Eテストの復旧・強化

## 🔮 将来の検討事項

- 多言語プロジェクト（Python, Go, Rust）での実績確認
- .kanon/config.json の追加オプション（タイムアウト、並行エージェント数など）
- ダッシュボードでのリトライ履歴の可視化
