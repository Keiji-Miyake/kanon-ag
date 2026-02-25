# Changelog

すべての変更はこのファイルに記録されます。

## [0.0.0] - 2026-02-25

### Added

- **マルチエージェント・オーケストレーション**: Architect → Developer → Reviewer の3段階パイプライン
- **自律ゲートキーピング**: 生成コードを自動検証（Lint/Build）し、エラー時は自律修正ループを実行
- **Faceted Prompting**: Persona / Policy / Instruction / Knowledge / Output Contract の5ファセットによるプロンプト合成
- **決定論的ルーティング**: FSM（有限オートマトン）ベースの状態遷移エンジン
- **マージ・ゲートウェイ**: all/any 条件に基づくフィードバック集約ロジック
- **Git Worktree サンドボックス**: タスクごとに完全に隔離された実行環境を自動生成
- **`.kanon/config.json` 設定ファイル**: プロジェクトごとのエージェント割り当て・リトライ回数カスタマイズ
- **Antigravity ダッシュボード**: VS Code拡張機能によるリアルタイムモニタリング（WebSocket）
- **ユニットテスト**: Vitest 7ファイル / 56テストケース（Domain / UseCases / Infrastructure 層）
- **エージェントスキル定義**: 10種のスキル（architect, conductor, developer, qa, devops 他）
