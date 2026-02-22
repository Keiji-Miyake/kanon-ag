# ダッシュボードからの実行（Run Button / Send）機能の修正計画

## 概要

現在 `feat/dashboard-state-sync` 等によるダッシュボード刷新は成功したが、パネルから「Send」ボタンや「Run All」ボタン経由でタスクを実行しようとすると、以下のエラーが発生して動作しない。

```text
Error: Cannot find module '/home/user/.antigravity-server/dist/orchestrate.js'
```

### 問題の原因

ダッシュボード側の拡張機能（`src/extension/src/extension.ts`）でオーケストレーションを実行する際、フォールバックとして VS Code のパス（`_extensionUri` を基にしたローカルパスなど）に依存しているか、もしくは Antigravity 環境下で不正なパス解決が行われているため、`kanon` CLI 本体あるいは `orchestrate.js` が正しく起動できていない。

## 実装計画

### 1. 実行パスの解析と修正 (`src/extension/src/extension.ts`)

- 現在の `runWorkflow` 関数におけるコマンド組み立てのロジックを確認し、Antigravity (開発・実行環境) に依存したハードコードパスを取り除く。
- npm グローバルにインストールされた `kanon run` などの CLI コマンドを最優先に利用するようにする（volta への依存の問題の可能性も検証する）。
- 万が一拡張機能内に同梱されたスクリプトを呼び出す場合は、正しい `__dirname` または `extensionUri` から相対パスを使って確実にファイルを指定する。

### 2. 環境変数とターミナルの調整

- Volta など Node.js のバージョン管理ツールがターミナル上でエラーを出していることも考慮し、ターミナル生成時に適切な PATH が維持されるようにする。

### 3. ダッシュボードから送信されるタスク引数のエスケープ処理の見直し

- 「Send」ボタンでタスクを投げた際に空白や特殊文字が含まれていても、正しく CLI コマンドとして処理されるか確認し、堅牢にする。

## タスク一覧

- [x] `src/extension/src/extension.ts` の `runWorkflow` メソッド内のコマンド生成ロジックを確認し、修正点を洗い出す
- [x] 拡張機能内の `orchestrate.js` のパス解決か、CLI コマンド (`kanon`) のパス解決を修正する
- [x] 修正内容を `esbuild` でビルドし、VSIX を再作成・インストールして動作確認を行う
- [x] ダッシュボードから「Send」または「Run All」を押してタスクが正常に実行されるか E2E で確認する
