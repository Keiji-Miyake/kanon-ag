# skill-tester 仕様書

## 概要

`skill-tester` は、プロジェクト内の他のエージェントスキルが、設計通りの振る舞いをするかを検証するための「QAエージェント」である。
ユーザーが手動で確認する手間を省き、CI/CD的にスキルの品質を担保することを目的とする。

## 役割 (Role)

* **Auditor (監査員)**: `SKILL.md` の構造や記述内容がプロジェクトのルールに準拠しているかチェックする。
* **Simulator (シミュレーター)**: ユーザーになりきって対象スキルに指示を出し（ドライラン）、その応答が期待値と合致するか判定する。

## 機能要件

1. **静的解析 (Static Analysis)**
    * `SKILL.md` のYAMLフロントマター（name, description, version, ...）の検証。
    * 必須セクション（Workflow, Rules, Commadsなど）の存在確認。
    * 日本語での記述チェック（General Rules準拠）。

2. **シナリオテスト (Scenario Testing)**
    * `docs/dev/<feature>/TEST_CASES.md` からテストケースを読み込む。
    * 各テストケースについて、以下のプロセスを実行（シミュレーション）する:
        1. **Context Setup**: テストに必要な前提条件（ファイル、状態）を認識する。
        2. **Prompting**: 定義された「User Input」をスキルに与える（シミュレーション）。
        3. **Verification**: スキルが生成するであろうツール呼び出しや応答が、「Expected Behavior」と一致するか評価する。
    * **注意**: 実際にツールを実行して副作用（ファイル削除など）を起こすのではなく、「思考プロセスとツール呼び出しの意図」を検証することが主眼。（"Dry Run" mode）

## 入出力

* **入力**: 対象スキル名（例: `qa`）、またはスキルパス。
* **出力**: テスト完了レポート（Markdown形式）。
  * 各テストケースの Pass/Fail 判定。
  * 失敗時の原因分析。
  * 改善提案。

## 依存関係

* `skills/<target_skill>/SKILL.md`
* `docs/dev/<target_skill>/TEST_CASES.md` (テスト定義)
