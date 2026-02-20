# skill-tester テスト計画 & ケース定義

これは `skill-tester` 自身を検証するためのテストケースであり、かつ **他のスキルのテストケースを作成するためのテンプレート** としても機能する。

## テスト戦略
`skill-tester` は「他のスキルをテストするスキル」であるため、以下の2段階で検証する。

1.  **Self-Correction**: `skill-tester` 自身の `SKILL.md` が静的解析ルールを満たしているか。
2.  **Mock Validation**: 意図的に壊れたスキルや、完璧なスキルを渡したときに、正しく Pass/Fail を判定できるか。

## テストケース (Template)

### Case 1: 正常系 - 有効なスキルの検証
*   **Title**: Valid Skill Validation
*   **Context**:
    *   対象スキル: `skills/session-support` (既存の安定したスキル)
    *   `docs/dev/session-support/TEST_CASES.md` が存在すると仮定
*   **User Input**:
    ```
    @skill-tester verify session-support
    ```
*   **Expected Behavior**:
    *   `skills/session-support/SKILL.md` を読み込む。
    *   YAMLフロントマターが有効であることを報告。
    *   必須セクションが存在することを報告。
    *   テストケースをパスしたことを報告。
    *   **Result**: ✅ PASS

### Case 2: 異常系 - 必須セクション欠落の検出
*   **Title**: Missing Section Detection
*   **Context**:
    *   仮想スキル: `skills/broken-skill`
    *   `SKILL.md` に `# Workflow` セクションが存在しない。
*   **User Input**:
    ```
    @skill-tester verify broken-skill
    ```
*   **Expected Behavior**:
    *   静的解析フェーズでエラーを検出。
    *   「Workflowセクションが見つかりません」という警告を出力。
    *   **Result**: ❌ FAIL (正しくFail判定できること)

### Case 3: シナリオ検証 - 誤った振る舞いの指摘
*   **Title**: Incorrect Behavior Detection
*   **Context**:
    *   仮想スキル: `skills/lazy-coder`
    *   テストケース: "コードを書くこと" -> 期待値: "コードブロックを出力する"
    *   実際の振る舞い（シミュレーション）: "わかりません" とだけ答える。
*   **User Input**:
    ```
    @skill-tester run-scenario lazy-coder case-1
    ```
*   **Expected Behavior**:
    *   ユーザー入力に対して、スキルが期待されるコード生成を行わなかったことを検出。
    *   「期待される出力（コードブロック）が含まれていません」と報告。
    *   **Result**: ✅ PASS (バグを正しく検出できたため、Test Runnerとしては成功)

---

## テストケース記述テンプレート (For Project)

新規スキルを作成する際は、以下のフォーマットで `docs/dev/<feature>/TEST_CASES.md` を作成してください。

```markdown
# <Skill Name> Test Cases

## Case 1: [テストケース名]
* **Description**: [何をテストするか]
* **Pre-conditions**: [事前条件・必要なファイル]
* **User Input**:
  > [ユーザーのプロンプト]
* **Expected Output**:
  * [期待されるアクション1 (例: file_viewツールの呼び出し)]
  * [期待される回答内容]
```
