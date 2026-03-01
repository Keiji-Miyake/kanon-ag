# テスト手順書：ダッシュボード状態同期 (dashboard-state-sync)

## 概要

このドキュメントは `feat/dashboard-state-sync` ブランチで実装した以下の機能を検証するためのテスト手順書です。

| 検証対象 | 内容 |
|---|---|
| ビルド確認 | chokidar を含む拡張機能のコンパイルが通るか |
| UI表示確認 | 状態ベースの新UIが正しく表示されるか |
| ファイル監視連携 | `.memories/` 変更がリアルタイムでダッシュボードに反映されるか |
| 状態復元 | タブを閉じて再度開いたとき、過去の状態が復元されるか |
| 再接続ロジック | 指数バックオフで正しく再接続されるか |

---

## 事前準備

### 必要環境

- Antigravity (VS Code 互換エディタ) がインストール済みであること
- Node.js 18以上
- `kanon` CLI がパス上に存在すること（なければ `npx` でも可）

### ステップ 0：ビルド確認

```bash
# worktree ディレクトリで実行
cd /home/user/workspace/kanon-ag/dashboard-state-sync/src/extension

# 依存関係のインストール（未実施の場合）
npm install

# TypeScript → JS バンドル
npm run compile
```

**期待結果:**

```
> esbuild ./src/extension.ts --bundle --outfile=dist/extension.js ...
  dist/extension.js  338.8kb （目安）
⚡ Done in XXms
```

- `dist/extension.js` が生成されること
- エラーメッセージが出ないこと

---

## テスト 1：VSIX パッケージ生成

```bash
cd /home/user/workspace/kanon-ag/dashboard-state-sync/src/extension

# vsce がなければインストール
npm install -g @vscode/vsce

# VSIX 生成
vsce package --no-dependencies
```

**期待結果:**

- `kanon-antigravity-extension-*.vsix` ファイルが生成される
- `ws` および `chokidar` が `dist/extension.js` 内にバンドルされていること

> **確認方法（バンドル内容）:**
>
> ```bash
> grep -c "chokidar" dist/extension.js
> # 0より大きい数が返ればバンドル済み
> ```

---

## テスト 2：VSIX インストールとダッシュボード表示確認

### 2-1. 拡張機能のインストール

1. Antigravity の **拡張機能マネージャー**（サイドバー左下のアイコン）を開く
2. 「`...`」メニュー → **「VSIXからインストール...」** を選択
3. 生成した `.vsix` ファイルを選択してインストール
4. 「再読み込み」を求められた場合は実行する

### 2-2. ダッシュボードを開く

1. アクティビティバーの **Kanon アイコン**（⚡マーク）をクリック
2. サイドバーに「Dashboard」パネルが表示されること

**期待結果（初期表示）:**

| UI要素 | 期待値 |
|---|---|
| ヘッダー | `⚡ Kanon Dashboard` が表示される |
| 接続ステータス | `Disconnected`（赤バッジ）→ 数秒後に `Connected`（緑バッジ）に変わる |
| セッション情報 | `セッション: --` / `タスクなし` |
| 全体ステータスバッジ | `idle`（グレー）|
| エージェントステータス表 | Conductor / Architect / Developer / QC の4行が表示される |
| タブ | 「状態」「ログ」の2タブが表示される |

---

## テスト 3：ファイル監視によるリアルタイム状態更新

`.memories/` ディレクトリへの書き込みがダッシュボードに即座に反映されることを確認します。

### 3-1. テスト用 `.memories/` ディレクトリの作成

```bash
# ワークスペースルートで実行
mkdir -p /home/user/workspace/kanon-ag/dashboard-state-sync/.memories/progress
```

### 3-2. session.md の書き込みテスト

```bash
cat > /home/user/workspace/kanon-ag/dashboard-state-sync/.memories/session.md << 'EOF'
# Session: test-session-001

sessionId: test-session-001
task: ダッシュボード状態同期のテスト
status: running
startedAt: 2026-03-01T08:00:00Z
EOF
```

**期待結果（ダッシュボード側）:**

| UI要素 | 期待値 |
|---|---|
| セッションID | `Session: test-session…` |
| タスク名 | `ダッシュボード状態同期のテスト` |
| 全体ステータスバッジ | `⚙ running`（青バッジ）に変わる |

### 3-3. エージェント進捗（progress/*.md）の書き込みテスト

```bash
cat > /home/user/workspace/kanon-ag/dashboard-state-sync/.memories/progress/architect.md << 'EOF'
# Architect Progress

status: running
## Last Message
実装計画を策定中...
EOF
```

**期待結果:**

| UI要素 | 期待値 |
|---|---|
| エージェントステータス表 の Architect 行 | ドットが青（pulse アニメーション）になり、ステータスラベルが `running` に変わる |
| Architect の最終メッセージカラム | `実装計画を策定中...` が表示される |

### 3-4. 完了状態への更新テスト

```bash
cat > /home/user/workspace/kanon-ag/dashboard-state-sync/.memories/progress/architect.md << 'EOF'
# Architect Progress

status: done
## Last Message
実装計画が完了しました
EOF

# session.md も完了に更新
sed -i 's/status: running/status: done/' \
  /home/user/workspace/kanon-ag/dashboard-state-sync/.memories/session.md
```

**期待結果:**

| UI要素 | 期待値 |
|---|---|
| 全体ステータスバッジ | `✔ done`（緑バッジ）に変わる |
| Architect のドット | 緑に変わる |
| ステータスラベル | `done`（緑バッジ）に変わる |

---

## テスト 4：状態復元（レジリエンステスト）

ダッシュボードタブを閉じて再度開いたとき、過去の状態が復元されることを確認します。

### 手順

1. テスト 3 を実行して `.memories/` に状態データが書き込まれた状態にする
2. ダッシュボードパネルの **✕ アイコン**をクリックしてパネルを閉じる
3. 別のファイル（例: `README.md`）をエディタで開く
4. アクティビティバーの Kanon アイコンをクリックして**ダッシュボードを再度開く**

**期待結果:**

| 確認項目 | 期待値 |
|---|---|
| タスク名 | `ダッシュボード状態同期のテスト`（前回と同じ）が即座に表示される |
| 全体ステータス | 最後に書き込んだ状態（`done` など）が復元されている |
| エージェントステータス | 各エージェントの状態が前回終了時のまま表示される |
| 再表示の遅延 | WebSocket 接続後 1秒以内に状態が反映されること |

> **仕組み:** サーバー側はクライアント接続時に `broadcastState()` を即時呼び出し、現在の `KanonState` を丸ごと送信します。これにより、ダッシュボードを開き直しても状態が即座に復元されます。

---

## テスト 5：WebSocket 指数バックオフ再接続テスト

### 5-1. 再接続の動作確認

1. ダッシュボードが `Connected` 状態であることを確認する
2. Antigravity のターミナルで、WebSocket サーバー（ポート 3001）プロセスを確認する：

   ```bash
   lsof -i :3001
   ```

3. ダッシュボードのステータスバッジが `Reconnecting…`（オレンジ）に変わることを確認する
4. 拡張機能が自動で再起動し `Connected` に戻ることを待つ

### 5-2. 指数バックオフの順序確認

| 試行回数 | 待機時間（理論値） |
|---|---|
| 1回目 | 1秒 |
| 2回目 | 2秒 |
| 3回目 | 4秒 |
| 4回目 | 8秒 |
| 5回目以降 | 最大 30秒 |

**確認方法:** ブラウザの開発者ツール（`F12`）相当のデバッグコンソールで WebSocket の接続・切断ログを確認。

---

## テスト 6：kanon run との実連携テスト（エンドツーエンド）

### 手順

1. ダッシュボードを開き、`Connected` 状態であることを確認する
2. チャット入力欄に以下を入力：

   ```
   Hello World TypeScript を作成してください
   ```

3. **🚀 Run All** ボタンをクリックする
4. ターミナルで `kanon run` が実行されること、`.memories/` 配下にファイルが生成されることを確認する

**期待結果:**

| タイミング | ダッシュボードの変化 |
|---|---|
| kanon 起動直後 | 全体ステータスが `running` に変わる |
| Architect 処理中 | Architect 行が `running`（pulse）になる |
| Developer 処理中 | Developer 行が `running`（pulse）になる |
| 完了時 | 全体ステータスが `done` に変わり全エージェントが `done` になる |
| ログタブ | タブ切り替えで従来のログ一覧も確認できる |

---

## テスト 7：クリーンアップ

テスト用ファイルを削除して初期状態に戻します。

```bash
rm -rf /home/user/workspace/kanon-ag/dashboard-state-sync/.memories/
```

**期待結果:**

- ダッシュボードが自動的に `セッション: --` / `タスクなし` / `idle` に戻る（chokidar の `unlink` イベントで検知）

---

## 合否判定基準

| テスト | 合格条件 |
|---|---|
| T1 ビルド | エラーなしで `dist/extension.js` が生成される |
| T2 UI表示 | 新UIの全要素が正しく表示される |
| T3 ファイル監視 | `.memories/` 書き込みから **3秒以内** に画面に反映される |
| T4 状態復元 | タブ再開後 **1秒以内** に前回状態が表示される |
| T5 再接続 | 指数バックオフで再接続し `Connected` に復帰する |
| T6 連携 | `kanon run` 実行中にエージェント状態が 逐次更新される |
| T7 クリーンアップ | `.memories/` 削除後にUIが `idle` に戻る |

---

## トラブルシューティング

### ダッシュボードが `Connected` にならない

- ポート 3001 の競合を確認: `lsof -i :3001`
- 拡張機能の再起動: コマンドパレット → **「開発者: ウィンドウの再読み込み」**

### `.memories/` の変更が反映されない

- 拡張機能ログを確認: コマンドパレット → **「開発者: 拡張機能ホストのログを開く」**
- `[Kanon] .memories/ 監視開始:` のログが出ているか確認
- ワークスペースフォルダが正しく認識されているか確認

### 状態が復元されない

- WebSocket 再接続後に `type: "state"` メッセージが届いているか確認
- `.memories/session.md` が存在し、パース可能な形式か確認
