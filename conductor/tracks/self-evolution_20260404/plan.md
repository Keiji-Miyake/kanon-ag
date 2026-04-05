# 実装計画: 自己改善ループ (Self-Evolution) の洗練

## 1. 現状の不整合の解消 (Hotfix)
- [x] `src/cli/memory-manager.ts` のシンタックスエラー修正（不要な行の削除と関数の整理）
- [x] `src/cli/orchestrate.ts` で削除された `runPassage` を `OrchestrationService` を呼び出す形で再実装

## 2. Core Model の拡張
- [x] `src/domain/models/score.ts` に `outputContract` フィールドを追加 (Faceted Promptingの基盤)
- [x] `src/usecases/orchestration/orchestrationService.ts` にて、Passage実行時に `outputContract` をプロンプトに組み込む

## 3. 自律的実行ルール修正 (Self-Correction)
- [x] `AIWatchdog` が停滞を検知した際、`architect` エージェントを起動して `score.json` を修正するロジックの実装
- [x] `OrchestrationService` に修正された `score.json` を再読み込みして実行を継続するフローを追加

## 4. 実行後リフレクション (Post-Task Reflection)
- [x] タスク完了時に `OrchestrationService` が実行履歴を分析する `reflect()` メソッドを呼び出す
- [x] 分析結果を `facets/policy/` に Markdown 形式で保存するロジックの実装

## 5. 動作検証
- [x] モックエージェントを使用した、無限ループからの自律復帰テスト
- [x] タスク完了後のポリシー自動生成の確認
