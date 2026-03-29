# 2026-03-28 Kanon サブエージェントとスキルの詳細設計

## 1. 概要 (Overview)

Kanon プロジェクトにおける自律開発ライフサイクルを加速し、コスト効率と品質を両立させるために、5 体の特化型サブエージェントを導入する。
「最強の脳と目（Pro 3.1）」と「最速の手足（Flash）」という役割分担により、人間が介在せずとも「設計 -> 実装 -> レビュー -> 修正 -> 検証」のサイクルを自律的に回す。

## 2. エージェント構成 (Agent Roles)

各エージェントは `.github/agents/` 配下に定義され、メインエージェント（Conductor）から `@名前` で呼び出される。

| エージェント | モデル | 役割 | 主なツール |
| :--- | :--- | :--- | :--- |
| **Architect** | **Pro 3.1** | **【脳】** 要件分析と詳細設計 (`implementation_plan.md`) の作成。 | `read_file`, `write_file`, `list_directory` |
| **Developer** | **Flash** | **【手】** 設計に基づく初回実装とファイル作成。 | `write_file`, `run_shell_command` |
| **Reviewer** | **Pro 3.1** | **【目】** 厳格な監査。設計書とコードを照合し、修正案を生成。 | `read_file`, `grep_search` |
| **Worker** | **Flash** | **【手】** 指示に基づき、既存コードをピンポイントで外科的修正。 | `replace`, `read_file` |
| **Tester** | **Flash** | **【足】** Vitest を使用したテスト実行とエラーログ解析。 | `run_shell_command`, `glob` |

## 3. スキル定義 (Skill Specifications)

各エージェントが「何をすべきか」を定義する `SKILL.md` を `skills/` 配下に作成・配置する。

### 3.1 Reviewer Skill (`skills/reviewer/SKILL.md`)
- **チェックリスト**:
  - クリーンアーキテクチャの遵守（domain 層に外部依存がないか）。
  - プロジェクト規約（命名、ファイル配置、Vitest 形式）。
  - セキュリティ（エラーハンドリング、機密情報の露出）。
  - パフォーマンス、単語・用語の統一、脆弱性パッケージ。
- **アウトプット**: Worker がそのまま適用可能な、具体的な `replace` 命令のための修正内容。

### 3.2 Worker Skill (`skills/worker/SKILL.md`)
- **外科的修正の原則**: 
  - 最小限の変更で、副作用を避ける。
  - インデント、改行、コーディングスタイルを完璧に維持する。
  - レビュー指摘箇所以外には 1 文字も触れない。
- **ツール活用**: `replace` ツールを駆使し、部分置換を行う。

### 3.3 Tester Skill (`skills/tester/SKILL.md`)
- **検証手順**:
  - `npm run test:e2e` を実行し、結果を解析。
  - 失敗時は、スタックトレースから「どのファイル・どの行」で「期待値と実際の結果」に乖離があるかを特定。
  - 修正に必要な情報を Worker に受け渡す。

## 4. 統合ワークフロー (Integration)

1. **Conductor** -> **Architect**: 要件から設計書を作成。
2. **Conductor** -> **Developer**: 設計書に基づき、初回コードを実装。
3. **Conductor** -> **Reviewer**: 実装コードをレビュー。不備があれば指摘リストを生成。
4. **Conductor** -> **Worker**: レビュー指摘を適用して修正。
5. **Conductor** -> **Tester**: テスト実行。失敗すれば原因を添えて Worker に戻す（ループ）。
6. **Conductor**: すべてクリアしたら、ユーザーに完了報告。

## 5. 成功基準 (Success Criteria)

1. 5 体のサブエージェントが `@名前` で呼び出し可能であること。
2. `npm run test:e2e` が正常に終了し、Reviewer の指摘がすべて解消されていること。
3. 修正後のコードが、既存のコードベースと一貫したスタイルを維持していること。
