# Implementation Plan: 状態復旧（チェックポインティング）の強化

## 1. データモデルの拡張 (Core)
* [x] 
 `src/cli/memory-manager.ts` の `SessionInfo` に `currentPassage?: string` と `worktreePath?: string` を追加。
* [x] 
 `src/domain/services/scoreExecutor.ts` に `skipToPassage(passageName: string)` メソッドを追加し、内部の `currentPassageName` を指定された位置まで進められるようにする。

## 2. 進捗保存の実装 (Persistence)
* [x] 
 `src/cli/orchestrate.ts` の `runScore` ループ内で、Passage が成功するごとに `updateSession` を呼び出し、現在の Passage 名とワークツリーの絶対パスを保存するようにする。

## 3. レジューム機能の実装 (Resumption)
* [x] 
 `src/cli/orchestrate.ts` に `runResumeScore()` 関数を追加。
    * [x] 
 `readSession()` で前回の中断セッションを取得。
    * [x] 
 ワークツリーパスが保存されていれば、新規作成せずにそのパスを `LocalGitSandbox` に再利用させる。
    * [x] 
 保存された `currentPassage` を `executor.skipToPassage()` で復元。
* [x] 
 `main()` 関数で `score` コマンドを受け取る際、`--resume` フラグがある場合は `runResumeScore()` を呼び出すようにする。

## 4. 失敗時の環境保護 (Durability)
* [x] 
 `src/cli/orchestrate.ts` の `runScore` の `finally` ブロックを修正。
    * [x] 
 `isStalled` が false かつ `isSuccess` が false の場合（タイムアウトやエラーなど）、ワークツリーを削除せずに保持し、ユーザーに再開方法を表示する。

## 5. 動作検証 (Verification)
* [x] 
 **テストケース1**: タイムアウトを発生させ、`.memories/session.md` に進捗が保存され、ワークツリーが保持されることを確認。
* [x] 
 **テストケース2**: `kanon score --resume` を実行し、中断された Passage から継続実行されることを確認。
* [x] 
 **テストケース3**: 最後まで実行が成功し、ワークツリーが正常にマージ・削除されることを確認。
