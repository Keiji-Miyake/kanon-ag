# Kanon 開発 TODO

Kanon（カノン）オーケストレーションツールの次世代アーキテクチャに基づいた開発ロードマップ・タスク一覧です。

## 🚀 Phase 1: ドメイン設計とコア基盤の構築

純粋なビジネスロジックとドメインモデルを定義します。

- [ ] `domain/models/promptFacet.ts` の実装 (5ファセットの型定義)
- [ ] `domain/models/agentState.ts`, `feedback.ts` の実装
- [ ] `domain/models/fsmNode.ts` の実装 (ノード・エッジの定義)
- [ ] `domain/repositories/` 配下の抽象インターフェース定義 (Blackboard, Sandbox)

## 🧩 Phase 2: ユースケース層の実装 (オーケストレーションの中核)

決定論的なルーティングとプロンプト制御機能を実装します。

- [ ] `usecases/prompt/synthesizer.ts` の実装 (Policy末尾配置ロジック)
- [ ] `usecases/prompt/feedbackInjector.ts` の実装 (指摘事項の動的合成)
- [ ] `domain/services/mergeGateway.ts` の実装 (all/any集約条件ロジック)
- [ ] `usecases/orchestration/transitionEngine.ts` の実装 (FSMに基づく状態遷移)

## 🏗 Phase 3: インフラストラクチャ・外部統合と環境サンドボックス

外部依存（Git, LLM, KV Storeなど）と連携する実装を提供します。

- [ ] `infrastructure/git/localGitSandbox.ts` (Git Worktree操作の実装)
- [ ] `usecases/environment/worktreeManager.ts` によるタスクごとの隔離環境管理の結合
- [ ] `infrastructure/contextBus/redisBlackboard.ts` (共有黒板パターンのインメモリ/Redis実装)
- [ ] YAML等でのワークフロー定義読み込み (`yamlWorkflowParser.ts`)

## 🤖 Phase 4: エージェントループと並行処理の結合

複数のエージェントが協調して動作する並行修正ループを完成させます。

- [ ] `ReviewOrchestrator` クラスの実装と非同期レビュー実行の基盤
- [ ] レビュアーからのフィードバック集約と `MergeGateway` への転送処理
- [ ] 差し戻し時の `Instruction` 再生成ループ（自律デバッグループ）のE2E動作保証

## 🌐 Phase 5: UI/インテグレーション

- [ ] Antigravity / ダッシュボードUIとの統合
- [ ] CLI (`kanon` コマンド) 経由での新アーキテクチャ版実行のサポート
