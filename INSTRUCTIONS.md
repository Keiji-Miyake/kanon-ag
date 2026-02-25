# Kanon クイックリファレンス

## 一括実行（推奨）

```bash
kanon run --task="タスクの説明"
```

## ステップ別実行

```bash
kanon plan --task="タスクの説明"   # 1. 実装計画を策定
kanon execute                       # 2. 計画に基づいて実装
kanon review                        # 3. 最終レビュー
```

## ダッシュボード

```bash
kanon ui   # VS Code Antigravity ダッシュボードを起動
```

## 開発コマンド

```bash
npm run build       # 全体ビルド
npm run test:unit   # ユニットテスト実行
```

詳細は [README.ja.md](./README.ja.md) または [docs/GET_STARTED.ja.md](./docs/GET_STARTED.ja.md) を参照してください。
