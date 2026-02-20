# Walkthrough: Blog Skills Development

## 実施内容

1. **blog-writer の初期実装**: 執筆、SEO、Mermaid生成機能を持つスキルを作成。
2. **tech-storyteller の追加**: 履歴解析の専門スキルを新設。
3. **疎結合化のリファクタリング**:
    - 両スキルの相互参照を削除。
    - 汎用的な「素材（Material）」を介した連携フローへと変更。
4. **検証**: `npm run validate` によるプロジェクト規約確認。

## 成果物

- `skills/blog-writer/`
- `skills/tech-storyteller/`
- `docs/dev/blog-skills/SPEC.md`
- `docs/dev/blog-skills/WALKTHROUGH.md`

## テスト結果

- 全てのバリデーションに合格。
- 実際の履歴からブログ記事を生成するデモを実施し、品質を確認。
