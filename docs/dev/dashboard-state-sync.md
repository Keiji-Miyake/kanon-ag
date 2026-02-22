# Dashboard State Sync Implementation Plan

## Goal

oh-my-ag のアーキテクチャに倣い、Kanon のダッシュボードUIをファイル監視による「状態同期型（State-driven）」へと高度化し、堅牢なWebSocket再接続ロジックを導入する。これにより、ダッシュボードを開き直しても過去の進行状態が正しく復元され、リッチなUI表現の基盤を構築する。

## User Review Required
>
> [!IMPORTANT]
> この改修により、ダッシュボードの表示が「単なるログの羅列」から「現在のタスクボードと最新アクティビティを示す状態表示」へと大きく変わる予定です。また、これに伴い `kanon-ag/main/node_modules/chokidar` 等が必要になるため、拡張機能側（`src/extension/package.json`）にも `chokidar` への依存関係を追加します。

## Proposed Changes

### `kanon-ag/main/src/extension/`

拡張機能本体およびダッシュボード側の修正を行います。

#### [MODIFY] package.json

- `dependencies` に `chokidar` と `@types/chokidar` (dev) を追加
- UI状態同期のため、ファイル監視ライブラリを導入。

#### [MODIFY] src/extension.ts

- **バックエンド（WebSocketサーバー）の実装変更**:
  - `startEmbeddedServer()` 内に `chokidar` を用いたファイル監視処理を追加。現在のワークスペースの `.memories/` ディレクトリを対象とする。
  - `.memories/session.md`, `task-board.md`, `progress/*.md` などを読み取ってJSONオブジェクト（State）に変換するパース処理を追加。
  - 変更を検知したタイミングと、ダッシュボードが接続されたタイミングで、パースした状態全体をWebSocketクライアントにブロードキャスト（`broadcastState()`）する仕様に変更。従来の文字列そのままの転送ロジックも、CLI互換のため一時的に保持するか検証して残す。
- **フロントエンド（WebView UI）の実装変更**:
  - `_getHtmlForWebview()` 内で出力する HTML / CSS を高度化。oh-my-agライクな「セッション情報ヘッダー」「エージェント毎のステータス表」「最新アクティビティ一覧」を表示できるレイアウトに変更する。
  - WebSocketの再接続ロジックを指数バックオフ（徐々に間隔をあける）方式に変更し、エディタのリロードやタブ切り替え時の切断に対する堅牢性を向上させる。
  - イベントハンドラを追加し、受信したJSONステートデータをDOMに反映させる（`renderState()` メソッドの実装）。

## Verification Plan

### 自動テスト（事前準備）

- 拡張機能（`src/extension`）のコンパイルとパッケージング（`.vsix` 生成）を `esbuild` で実行。依存関係 (`ws`, `chokidar`) が正常にバンドルされるか確認。

### 手動検証

1. **ダッシュボードの表示確認**: VSIXをインストールし、Kanon Dashboard を開く。
2. **連携機能のテスト**: ダッシュボードのチャット等からタスクを開始し、CLI側の `kanon run` 等が `.memories/` 配下のファイルを更新した際に、ダッシュボードの情報（状態表示）がリアルタイムで更新されることを確認する。
3. **レジリエンス（復旧機能）テスト**: 一度ダッシュボードのタブを閉じ、別のファイルを開いたあとに再度ダッシュボードを開き、「進行中のタスク内容」が最初から正確に復元表示されるか確認する。

---

# Tasks

- [x] Kanonの現在のファイル出力仕様（どこにタスク状態やログを保存しているか）を調査する
- [x] アーキテクチャと実装計画（implementation_plan.md）を策定し、ユーザーの承認を得る
- [x] ダッシュボードフロントエンドにWebSocketの指数バックオフ再接続ロジックを実装する
- [x] 拡張機能側にファイル監視（chokidar等）を導入し、エージェント状態のJSONを構築する処理を実装する
- [x] フロントエンド側のUIを状態ベース（State-driven）の表示に改修する
- [ ] 動作検証（ダッシュボードを開き直しても過去の進行状態が復元されるか確認）
