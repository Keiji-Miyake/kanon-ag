# ダッシュボードからのサーバー起動エラー修正とアーキテクチャ最適化

## ステータス: 計画段階（未完了）

作成日: 2026-02-27
ブランチ: `feat/remove-standalone-ui-server`
Worktree: `/home/user/workspace/kanon-ag/feat/remove-standalone-ui-server`

---

## 課題

ダッシュボードの「Start Server」ボタンを押すと以下のエラーが発生する:

```
Error: Cannot find module '/home/user/.antigravity-server/dist/orchestrate.js'
```

### 原因分析

1. `startKanonServer()` メソッドが `kanon ui || node --no-deprecation "..." ui` というコマンドをターミナルに送信する
2. `kanon` コマンドはグローバルにインストールされていないため失敗（Volta エラー）
3. フォールバックパスは `vscode.Uri.joinPath(this._extensionUri, '..', '..', 'dist', 'orchestrate.js')` で解決される
4. Antigravity 上では `_extensionUri` が `~/.antigravity-server/` 配下を指すため、プロジェクトの `dist/orchestrate.js` が見つからない

### そもそもなぜサーバー起動が必要だったのか

現在のアーキテクチャ:

```
[kanon CLI (ターミナル)] --WebSocket--> [kanon ui (別プロセス, ws://localhost:3001)] --WebSocket--> [VS Code 拡張ダッシュボード]
```

- `kanon execute` / `kanon run` 等の CLI ツールは単独プロセスとして動作
- これらのログをダッシュボード（拡張機能の Webview）にリアルタイム送信するため、中継役として `kanon ui` という **別の WebSocket サーバープロセス** を起動していた
- しかし、VS Code 拡張機能は Node.js プロセスとして動作するため、**拡張機能自体が WebSocket サーバーをホストできる**
- 別プロセスとして `kanon ui` を起動する必要は本来ない

---

## 提案する設計（修正方針）

不要な `kanon ui` プロセスを排除し、**VS Code 拡張機能内部（Node.js プロセス）** で直接 WebSocket サーバーを起動する。

### 新アーキテクチャ

```
[kanon CLI (ターミナル)] --WebSocket--> [VS Code 拡張機能 (ws://localhost:3001 をホスト)] --> [ダッシュボード Webview]
```

### メリット

- **「Start Server」ボタンが不要になる**: ダッシュボードを開いた瞬間に自動起動
- **パス解決エラーが発生しない**: 外部コマンド（`kanon ui`）を実行しないため
- **CLI 側のコードは変更不要**: `ws://localhost:3001` への接続は今まで通り

---

## 変更内容

### 1. `src/extension/package.json`

`ws` モジュールを拡張機能の依存関係に追加:

```json
{
  "dependencies": {
    "ws": "^8.19.0"
  },
  "devDependencies": {
    "@types/ws": "^8.18.1"
  }
}
```

### 2. `src/extension/src/extension.ts`

| 変更箇所 | 内容 |
|----------|------|
| インポート | `WebSocketServer`, `WebSocket`, `createServer` を追加 |
| `activate()` | 拡張機能起動時に `startEmbeddedServer()` を自動呼び出し |
| `deactivate()` | `stopEmbeddedServer()` でクリーンアップ |
| `startEmbeddedServer()` | **新規追加** - ポート 3001 で WebSocket サーバーを起動、CLI ログをブロードキャスト |
| `stopEmbeddedServer()` | **新規追加** - サーバーの停止処理 |
| `startKanonServer()` | **削除** - ターミナルで `kanon ui` を起動していた旧メソッド |
| `stopKanonServer()` | **削除** - 上記の停止メソッド |
| `serverTerminal` 変数 | **削除** - 不要になったグローバル変数 |
| HTML テンプレート | 「Start Server」「Stop Server」ボタンを削除 |
| `runWorkflow()` | `serverTerminal` への依存を削除（サーバーは自動起動済み） |

### 3. ビルド設定 (`esbuild`)

`ws` モジュールは Node.js ネイティブモジュールのため、esbuild の `--external` に追加が必要な場合がある。
現在の compile スクリプト:

```
esbuild ./src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node
```

`--platform=node` が指定されているので `ws` はバンドル可能だが、動作確認時に問題があれば `--external:ws` を追加する。

---

## 検証計画

1. `npm run compile` でビルドが通ることを確認
2. VS Code / Antigravity で拡張機能をリロード
3. ダッシュボードを開いた瞬間に「Connected」になることを確認
4. 「Run All」「Plan」ボタンが正常に動作することを確認
5. CLIからのログがダッシュボードに表示されることを確認

---

## 現在の進捗

- [x] 原因分析完了
- [x] 設計方針確定・承認済み
- [x] Worktree 作成済み (`feat/remove-standalone-ui-server`)
- [ ] `package.json` への `ws` 依存追加 → **部分的に実施済み（要確認）**
- [ ] `extension.ts` の書き換え → **部分的に実施済み（要確認）**
- [ ] ビルド確認
- [ ] 動作検証
- [ ] コミット・マージ
