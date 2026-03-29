# 実装計画: Faceted Prompting (プロンプトのモジュール化)

## Phase 1: ファセット・モデルと PromptAssembler の実装 (Red/Green TDD) [checkpoint: 7fffeed]
- [x] Task: 4つのファセット（Persona, Policy, Knowledge, Instruction）を定義するインターフェースを作成する [9cd1914]
- [x] Task: 指定されたディレクトリからファセット・ファイルを読み込み、結合する `PromptAssembler` サービスのテストを作成する [9cd1914]
- [x] Task: `PromptAssembler` サービスを実装し、テストをパスさせる [9cd1914]
- [x] Task: Conductor - User Manual Verification 'ファセット・モデルと PromptAssembler の実装' (Protocol in workflow.md)

## Phase 2: Passage への統合と実働確認 [checkpoint: 0c4afb7]
- [x] Task: `Passage` モデルを拡張し、`facets` (persona, policies, knowledge) を指定可能にする [68aabc3]
- [x] Task: `orchestrate.ts` の `runPassage` を更新し、`PromptAssembler` を使用してシステムプロンプトを構築するように変更する [68aabc3]
- [x] Task: `facets/` ディレクトリに、初期セット（architect 向けの persona, coding-standard 等）を配置する [68aabc3]
- [x] Task: Conductor - User Manual Verification 'Passage への統合と実働確認' (Protocol in workflow.md)
