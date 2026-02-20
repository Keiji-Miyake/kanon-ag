# Testing Rules

## テストと検証
- 修正後は `npm install` および `npx skills list` で整合性を確認する。
- 可能であれば `npx skills test skills/[skill-name]` で動作検証を行う。

## 外部エージェントによる検証 (Testing with External Agents)
スキルの動作検証には、以下のCLIコマンドを使用して複数のエージェントでクロスチェックを行うことを推奨します。

- **Gemini**: `gemini -p <prompt> --yolo`
- **Copilot**: `copilot -p "<prompt> --yolo"`
