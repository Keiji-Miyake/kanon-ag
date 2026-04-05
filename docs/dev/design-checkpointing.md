# 状態復旧 (Checkpointing) 詳細設計

## 1. 目標
中断された Passage やエージェント実行の途中状態から、ワークツリー（Git サンドボックス）の変更状態を失うことなく、シームレスに再開（Resume）できる仕組みを強化する。

## 2. 要件と課題
現状の仕組みでは、`score.json` に基づく自律ループ実行が中断された場合、`SessionInfo` に保存された `currentPassage` から再開される。
しかし、以下の課題がある：
- Passage 内で複数エージェントによるコンセンサスループ（`MAX_DELIBERATIONS`）が回っている最中に中断されると、その Passage の最初からやり直しになる。
- 実行エラー時のリトライループ（`MAX_RETRIES`）中に中断されると、以前のフィードバックが失われ、最初からやり直しになる。
- 過去の Passage の実行履歴（`executionHistory`）がメモリ上にしか存在しないため、再開後に AI Watchdog が Stalled（停滞）判定を行うためのコンテキストが欠落する。

## 3. 設計詳細

### 3.1 `SessionInfo` の拡張
これらの課題を解決するため、セッションの永続化オブジェクトである `SessionInfo` を拡張し、より詳細な実行状態（Checkpoint）を保持できるようにする。

```typescript
export interface PassageState {
    deliberationRound?: number;               // コンセンサスの現在のラウンド数
    completedSkills?: Record<string, string>; // パラレル実行で完了済みのスキルと出力結果
    attemptCount?: number;                    // runPassage での現在のリトライ回数
    currentFeedback?: string;                 // 直前のエラーによるフィードバックテキスト
}

export interface SessionInfo {
    id: string;
    status: 'initializing' | 'running' | 'completed' | 'failed';
    phase: string;
    command?: string;
    targetTask?: string;
    startedAt: string;
    updatedAt: string;
    workspace: string;
    currentPassage?: string;
    worktreePath?: string;

    // 追加: 状態復旧用の詳細データ
    executionHistory?: AgentOutput[]; // これまでの Passage の出力履歴
    passageState?: PassageState;      // 現在実行中の Passage の内部状態
}
```

### 3.2 実行状態の永続化
1. **ループごとの状態保存:**
   `OrchestrationService.ts` 内のループにおいて、コンセンサスの各ラウンドや `runPassage` のリトライが行われるたびに、最新の `passageState` を構築し、`updateSession` を通じてディスク (`.memories/session.json`) に保存する。
2. **履歴の保存:**
   各 Passage の実行が完了したタイミングで `executionHistory` に出力を追加し、これも永続化の対象とする。

### 3.3 `--resume` コマンドのロジック改善
CLI から `--resume` で再開された場合、以下のロジックで状態を復旧する：
1. **コンテキストの復旧:**
   `SessionInfo` から `executionHistory` をロードし、`OrchestrationService` の内部変数にセットする。
2. **ワークツリーの再利用:**
   `worktreePath` が存在し、ディレクトリが有効であることを検証する。無効な場合は警告を出して再構築または終了する。
3. **Passage 内の再開:**
   `currentPassage` にスキップしたのち、`passageState` に基づき以下の制御を行う。
   - `deliberationRound` が存在する場合は、そのラウンドからループを再開する。
   - `completedSkills` がある場合、パラレル実行時に既に完了しているスキルはスキップし、結果を再利用する。
   - `attemptCount` と `currentFeedback` が存在する場合、`runPassage` に渡し、リトライの続きとしてプロンプトを構築する。

## 4. 完了確認の手順

本機能の実装後、以下の手順で動作を確認し、要件を満たしているか検証する。

### 4.1 ユニットテスト
- **SessionInfoの永続化:**
  追加した `executionHistory` と `passageState` が JSON に正しくシリアライズ/デシリアライズされることをテストする。
- **OrchestrationServiceのResume:**
  モックした `SessionInfo` (特定の `deliberationRound` や `attemptCount` を持つ) を `runScore` に渡し、期待するラウンド/リトライ回数から処理が開始されることをログおよびスパイ関数から検証する。

### 4.2 手動 E2E テスト
1. **コンセンサス中の復旧テスト:**
   - 複数スキルによるコンセンサスが必要な Passage を含む `score.json` を用意する。
   - `kanon score` を実行し、コンセンサスのパラレル実行中（またはラウンド1の終了直後）に `Ctrl+C` で強制終了する。
   - `kanon score --resume` を実行する。
   - ログを確認し、ワークツリーが維持されたまま、中断されたラウンドから再開されること（または完了済みスキルの再実行がスキップされること）を確認する。
2. **履歴の引き継ぎテスト:**
   - いくつかの Passage を通過したあとで中断する。
   - Resume 後、意図的に AI Watchdog が呼び出される状態（Stall のシミュレート）を作り、Watchdog に渡されるプロンプトに以前の Passage の履歴が含まれていることを確認する。