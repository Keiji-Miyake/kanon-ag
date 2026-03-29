# Kanon サブエージェントとスキルの実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kanon プロジェクトに「最強の脳と目（Pro 3.1）」と「最速の手足（Flash）」という役割分担を持つ 5 体のサブエージェント（Architect, Developer, Reviewer, Worker, Tester）を導入し、自律的な開発サイクルを実現する。

**Architecture:** `.github/agents/` 配下にサブエージェント定義ファイルを作成し、`skills/` 配下にそれぞれの専門スキル (`SKILL.md`) を配置する。モデルはタスクの複雑さに応じて Pro 3.1 と Flash を使い分ける。

**Tech Stack:** Gemini 3.1 Pro Preview, Gemini 3 Flash Preview, Vitest, TypeScript, Node.js.

---

### Task 1: 共通ディレクトリの準備

**Files:**
- Create: `skills/reviewer/`
- Create: `skills/worker/`
- Create: `skills/tester/`

- [ ] **Step 1: 必要なディレクトリを作成する**
```bash
mkdir -p skills/reviewer skills/worker skills/tester
```

### Task 2: Reviewer スキルの作成

**Files:**
- Create: `skills/reviewer/SKILL.md`

- [ ] **Step 1: `skills/reviewer/SKILL.md` を作成する**
```markdown
---
name: reviewer
description: 高度なコードレビューと修正案生成。クリーンアーキテクチャ、規約、セキュリティを厳格に監査します。
---
# Reviewer Skill
あなたは設計とドメインに精通したエージェントです。
1. `implementation_plan.md` とコードを突き合わせ、仕様漏れがないか確認せよ。
2. クリーンアーキテクチャの原則、命名規則、単語の統一性をチェックせよ。
3. パフォーマンスとセキュリティ（脆弱性パッケージ含む）を評価せよ。
4. Worker がそのまま `replace` ツールで使用できる形式で、具体的な修正指示を出せ。
```

- [ ] **Step 2: コミットする**
```bash
git add skills/reviewer/SKILL.md
git commit -m "feat: add reviewer skill"
```

### Task 3: Worker スキルの作成

**Files:**
- Create: `skills/worker/SKILL.md`

- [ ] **Step 1: `skills/worker/SKILL.md` を作成する**
```markdown
---
name: worker
description: 指示に基づく既存コードのピンポイント修正。副作用を最小限に抑え、正確に `replace` を実行します。
---
# Worker Skill
あなたは軽量・高速・正確な修正担当エージェントです。
1. Reviewer の指摘や Tester の失敗ログを受け取り、修正箇所を特定せよ。
2. `replace` ツールを駆使し、最小限の変更で副作用なく修正せよ。
3. インデント、改行、スタイルを完璧に維持せよ。指示箇所以外には 1 文字も触れるな。
```

- [ ] **Step 2: コミットする**
```bash
git add skills/worker/SKILL.md
git commit -m "feat: add worker skill"
```

### Task 4: Tester スキルの作成

**Files:**
- Create: `skills/tester/SKILL.md`

- [ ] **Step 1: `skills/tester/SKILL.md` を作成する**
```markdown
---
name: tester
description: Vitest E2E テストの実行と結果解析。失敗原因を特定し、Worker に修正情報をパスします。
---
# Tester Skill
あなたは検証の専門家です。
1. `npm run test:e2e` を実行せよ。
2. 失敗時はスタックトレースを解析し、原因（ファイル、行、変数の状態）を特定せよ。
3. 修正に必要な詳細情報を Worker に伝えよ。
```

- [ ] **Step 2: コミットする**
```bash
git add skills/tester/SKILL.md
git commit -m "feat: add tester skill"
```

### Task 5: サブエージェント定義ファイルの作成

**Files:**
- Create: `.github/agents/architect.agent.md`
- Create: `.github/agents/developer.agent.md`
- Create: `.github/agents/reviewer.agent.md`
- Create: `.github/agents/worker.agent.md`
- Create: `.github/agents/tester.agent.md`

- [ ] **Step 1: Architect の定義を作成**
```markdown
---
name: architect
description: 高度な設計と計画作成。
model: gemini-3.1-pro-preview
tools: ["read_file", "write_file", "list_directory", "grep_search"]
---
あなたは設計者です。要件を分析し、クリーンアーキテクチャに基づいた `implementation_plan.md` を作成してください。
```

- [ ] **Step 2: Developer の定義を作成**
```markdown
---
name: developer
description: 設計に基づく初回実装。
model: gemini-3-flash-preview
tools: ["write_file", "read_file", "run_shell_command"]
---
あなたは開発者です。設計書を忠実にコード化し、新規機能を実装してください。
```

- [ ] **Step 3: Reviewer の定義を作成**
```markdown
---
name: reviewer
description: 厳格な監査と修正指示。
model: gemini-3.1-pro-preview
tools: ["read_file", "grep_search", "activate_skill"]
---
あなたは評価者です。設計と規約に基づきコードをレビューし、具体的な修正案を生成してください。
```

- [ ] **Step 4: Worker の定義を作成**
```markdown
---
name: worker
description: 高速なコード修正。
model: gemini-3-flash-preview
tools: ["replace", "read_file", "activate_skill"]
---
あなたは修正者です。レビュー指摘を正確にコードに反映してください。
```

- [ ] **Step 5: Tester の定義を作成**
```markdown
---
name: tester
description: テスト実行と検証。
model: gemini-3-flash-preview
tools: ["run_shell_command", "read_file", "activate_skill"]
---
あなたは検証者です。テストを実行し、品質を保証してください。
```

- [ ] **Step 6: まとめてコミットする**
```bash
git add .github/agents/*.agent.md
git commit -m "feat: add sub-agent definitions"
```

### Task 6: 最終確認

- [ ] **Step 1: `/agents` コマンドでエージェントが認識されているか確認する（ユーザーに依頼）**
- [ ] **Step 2: テスト的な呼び出し（例：`@reviewer このコードをチェックして`）が動作することを確認する（ユーザーに依頼）**
