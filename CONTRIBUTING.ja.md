# Kanon への貢献

貢献に興味を持っていただきありがとうございます！このドキュメントでは、Kanonオーケストレーション CLI への貢献に関するガイドラインを提供します。

## はじめに

1. このリポジトリをフォークします
2. フォークしたリポジトリをクローンします: `git clone https://github.com/Keiji-Miyake/kanon-ag.git`
3. ブランチを作成します: `git checkout -b feat/my-feature`
4. 依存関係をインストールします: `npm install`

## 開発

### ビルド

```bash
# CLI のビルド
npm run build:cli

# VS Code 拡張機能のビルド
npm run build:extension

# 全体ビルド
npm run build
```

### テスト

```bash
# ユニットテストの実行 (Vitest)
npm run test:unit
```

### プロジェクト構成

詳細なアーキテクチャについては [ARCHITECTURE.md](./docs/ARCHITECTURE.md) を参照してください。

```tree
src/
├── cli/            # CLIエントリポイント、エージェントランナー、設定ローダー
├── domain/         # 純粋なビジネスロジック（外部依存なし）
├── usecases/       # オーケストレーション・プロンプトユースケース
├── infrastructure/ # 外部連携実装（Git, Redis 等）
└── extension/      # VS Code拡張機能（Antigravity Dashboard）
tests/              # Vitestユニットテスト（src/ と同じ階層構成）
skills/             # エージェントスキル定義（SKILL.mdファイル）
```

## プルリクエストのプロセス

1. 変更がすべてのビルドとテストをパスすることを確認します
2. コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/) に従ってください
3. 以下を説明する明確な PR の説明文を記述します：
   - 変更が何をするか
   - なぜ必要か
   - どのようにテストしたか

## 行動規範

- 敬意を払い、包括的であること
- 建設的なフィードバックを提供すること
- 品質と保守性に焦点を当てること
- 他の人が学び、改善するのを助けること

## 質問がある場合

質問がある場合や助けが必要な場合は、Issue を作成してください！

## ライセンス

貢献することにより、あなたの貢献が MIT ライセンスの下でライセンスされることに同意したことになります。
