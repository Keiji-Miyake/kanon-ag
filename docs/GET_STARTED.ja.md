# 🚀 Kanon はじめてガイド

`kanon-ag` へようこそ！
Kanonは、複数のAIエージェントを統合し、ソフトウェア開発ライフサイクル全体（計画 → 実装 → レビュー）を自律的に遂行するオーケストレーションCLIです。

---

## 📦 インストール

```bash
# 依存関係のインストール
npm install

# CLIのビルド
npm run build:cli

# kanon コマンドをグローバルに使えるようにする
npm link
```

---

## 🤖 タスクを実行する

Kanonは「指揮者」として、Architect（設計） → Developer（実装） → Reviewer（レビュー）のパイプラインを自律的に実行します。

### 一括実行（推奨）

```bash
kanon run --task="ユーザー認証をAPIに追加する"
```

計画 → 実装 → 自動検証 → レビュー の全フェーズが、自律的に進行します。
Gatekeeperがビルド/テストエラーを検出した場合は、自動で修正ループが走ります。

### ステップ別実行

```bash
# 1. 実装計画を策定する
kanon plan --task="ユーザー認証をAPIに追加する"

# 2. 計画に基づいて実装を実行する
kanon execute

# 3. 最終レビューを実行する
kanon review
```

---

## 🖥️ Antigravity ダッシュボード（VS Code）

Kanonの動作をリアルタイムで監視するVS Code拡張機能です。

```bash
kanon ui   # WebSocketサーバーをポート3001で起動
```

VS Codeのサイドバーにある 🚀 アイコンをクリックしてダッシュボードを開きます。
エージェントの思考ログ、Gatekeeperの検証結果がリアルタイムでストリーミングされます。

---

## ⚙️ 設定ファイル

プロジェクトごとに `.kanon/config.json` を作成すると、エージェントの割り当てやリトライ回数をカスタマイズできます。
詳細は [README.ja.md](../README.ja.md) を参照してください。

---

## 📚 ドキュメント構成

- [README.ja.md](../README.ja.md): プロジェクト概要と設定リファレンス
- [ARCHITECTURE.md](./ARCHITECTURE.md): コアアーキテクチャと設計思想
- [CONTRIBUTING.ja.md](../CONTRIBUTING.ja.md): 貢献ガイドライン

---
[READMEに戻る](../README.ja.md)
