---
description: スキルの整合性とテストケースの有無を検証する
---

このワークフローは、プロジェクト内の全スキルに対して以下の検証を行います：
1. `SKILL.md` の構造（YAML Frontmatter）が正しいか
2. テストケース定義（`TEST_CASES.md`）が存在するか

以下のコマンドを実行して検証を開始します：

// turbo
```bash
npx tsx scripts/test-skills.ts $@
```

