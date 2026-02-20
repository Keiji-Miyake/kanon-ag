# テンプレートリポジトリ設定ガイド

## 概要
プロジェクト初期化時に使用するテンプレートリポジトリの設定方法です。

## 設定方法
`scripts/templates.json` に、利用したいテンプレートリポジトリの情報を追加してください。

### 設定例 (`templates.json`)
```json
{
  "my-template": {
    "name": "my-template-repo",
    "url": "https://github.com/your-org/your-template",
    "stack": "typescript-web",
    "description": "カスタムテンプレートの説明",
    "setupCommands": [
      "pnpm install",
      "pnpm run build"
    ]
  }
}
```

## 使用方法
プロジェクト初期化時に `--template` オプションを使用します。
```bash
node scripts/manage-dev.ts init my-project --template my-template
```
