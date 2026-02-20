# Kanon Architecture (アーキテクチャ)

Kanon は、Antigravity の機能を拡張し、自律的なマルチエージェント開発環境を実現するオーケストレーターです。

## 1. システム全体図 (System Overview)

```
[ 人間 (ユーザー) ]
       │ (要件定義)
       ▼
[ Kanon Orchestrator (Conductor) ] ◄───┐
       │                               │
       ├─[ Message Bus ]───────────────┤ (メッセージ交換)
       │                               │
       ├─[ Agent: PM ]─────────────────┤
       ├─[ Agent: Programmer ]─────────┤
       ├─[ Agent: Tester ]─────────────┤
       └─[ Agent: Operator ]───────────┘
               │
               ▼
[ 外部環境 / ツール (Git, FS, npm, etc.) ]
```

## 2. コアコンポーネント (Core Components)

### 2.1 Conductor (指揮者)
システムの中心となる脳です。
- ユーザーの入力を解析し、ワークフローを生成します。
- エージェントのステータス管理を行います。

### 2.2 Message Bus (メッセージ基盤)
エージェント同士が非同期で通信するための基盤です。
- 作業依頼、ステータス報告、レビュー結果などの転送。
- 通信ログを記録し、デバッグやトレーサビリティを確保します。

### 2.3 Knowledge Base / Context (知識ベース)
プロジェクトの「共通の文脈」を保持します。
- ソースコード、ドキュメント、テスト結果、過去の意思決定ログ。

## 3. 基本的なワークフロー (Standard Workflow)

1.  **Plan Phase**: PM エージェントが要求を解析し、`TODO.md` を更新してタスクを分解。
2.  **Implementation Phase**: Programmer エージェントがタスクを順次実行。
3.  **Validation Phase**: Tester エージェントが自動テストを実行。失敗した場合は Programmer へ差し戻し。
4.  **Finalization Phase**: Operator エージェントが変更を Git にコミットし、レポートを作成。

## 4. 通信プロトコル案
エージェント間のメッセージは JSON 形式で標準化します。

```json
{
  "type": "TASK_REQUEST",
  "from": "pm-agent",
  "to": "programmer-agent",
  "data": {
    "feature": "Implement auth middleware",
    "priority": "high",
    "context_files": ["src/middleware/auth.ts"]
  }
}
```

---
(C) 2026 Kanon Project / Keiji Miyake
