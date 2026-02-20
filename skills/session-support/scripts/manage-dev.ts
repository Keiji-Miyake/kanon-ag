#!/usr/bin/env node

/**
 * Dev Support: 多言語対応開発進捗管理スクリプト
 *
 * 用途:
 * - docs/dev/配下の機能別ドキュメントを解析
 * - 進捗状況をサマリー表示
 * - 新機能のスカフォールディング（技術スタック別テンプレート対応）
 *
 * 対応スタック:
 * - typescript-web: TypeScript (Expo, Hono, Next.js)
 * - python: Python (FastAPI, Django, Flask)
 * - go: Go (Gin, Echo, CLI)
 * - rust: Rust (Actix-web, Rocket)
 * - hardware: 電子工作 (Arduino, ESP32, Raspberry Pi)
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== 型定義 =====
type TechStack = "typescript-web" | "python" | "go" | "rust" | "hardware";

interface TemplateRepo {
	name: string;
	url: string;
	stack: TechStack;
	description: string;
	setupCommands: string[];
}

interface FeatureStatus {
	name: string;
	path: string;
	hasSpec: boolean;
	hasDesign: boolean;
	hasTestPlan: boolean;
	hasRoadmap: boolean;
	hasContext: boolean;
	hasHardware: boolean;
	techStack?: TechStack;
	progress: number; // 0-100
	lastModified?: Date;
	nextAction?: string;
	blockers: string[];
}

interface RoadmapData {
	progress: number;
	totalTasks: number;
	completedTasks: number;
	currentPhase: string;
	blockers: string[];
}

interface ContextData {
	lastWorkDate?: string;
	currentTask?: string;
	nextActions: string[];
}

// ===== テンプレートリポジトリ定義 (外部ファイルから取得可能にする) =====
let TEMPLATE_REPOS: Record<string, TemplateRepo> = {};

async function loadTemplates(): Promise<void> {
	const scriptDir = path.dirname(__filename);
	const configPath = path.join(scriptDir, "templates.json");

	if (await fileExists(configPath)) {
		try {
			const content = await fs.readFile(configPath, "utf-8");
			TEMPLATE_REPOS = JSON.parse(content);
		} catch (error) {
			console.error("⚠️  テンプレート設定の読み込みに失敗しました:", error);
		}
	}
}

// ===== ユーティリティ関数 =====
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readFile(filePath: string): Promise<string> {
	try {
		return await fs.readFile(filePath, "utf-8");
	} catch {
		return "";
	}
}

async function getFileModifiedDate(
	filePath: string,
): Promise<Date | undefined> {
	try {
		const stats = await fs.stat(filePath);
		return stats.mtime;
	} catch {
		return undefined;
	}
}

// ===== ドキュメント解析 =====
function parseRoadmap(content: string): RoadmapData {
	const progressMatch = content.match(/全体進捗[:\s]*(\d+)%/);
	const progress = progressMatch ? parseInt(progressMatch[1], 10) : 0;

	const tasksMatch = content.match(/(\d+)\/(\d+)\s*タスク完了/);
	const completedTasks = tasksMatch ? parseInt(tasksMatch[1], 10) : 0;
	const totalTasks = tasksMatch ? parseInt(tasksMatch[2], 10) : 0;

	const phaseMatch = content.match(/現在フェーズ[:\s]*(.+)/);
	const currentPhase = phaseMatch ? phaseMatch[1].trim() : "Unknown";

	const blockers: string[] = [];
	const blockerSection = content.split("## ブロッカー")[1];
	if (blockerSection) {
		const lines = blockerSection.split("\n");
		for (const line of lines) {
			if (line.trim().startsWith("-")) {
				blockers.push(line.replace(/^-\s*/, "").trim());
			}
		}
	}

	return { progress, totalTasks, completedTasks, currentPhase, blockers };
}

function parseContext(content: string): ContextData {
	const dateMatch = content.match(/最終作業日時[:\s]*\[?([^\]]+)\]?/);
	const lastWorkDate = dateMatch ? dateMatch[1].trim() : undefined;

	const taskMatch = content.match(/作業中のタスク[:\s]*\[?([^\]]+)\]?/);
	const currentTask = taskMatch ? taskMatch[1].trim() : undefined;

	const nextActions: string[] = [];
	const nextSection = content.split("## 次回セッションでやること")[1];
	if (nextSection) {
		const lines = nextSection.split("\n");
		for (const line of lines) {
			if (line.trim().match(/^\d+\./)) {
				nextActions.push(line.replace(/^\d+\.\s*/, "").trim());
			}
		}
	}

	return { lastWorkDate, currentTask, nextActions };
}

async function analyzeFeature(featurePath: string): Promise<FeatureStatus> {
	const name = path.basename(featurePath);

	const specPath = path.join(featurePath, "SPEC.md");
	const designPath = path.join(featurePath, "DESIGN.md");
	const testPlanPath = path.join(featurePath, "TEST_PLAN.md");
	const roadmapPath = path.join(featurePath, "ROADMAP.md");
	const contextPath = path.join(featurePath, "CONTEXT.md");
	const hardwarePath = path.join(featurePath, "HARDWARE.md");

	const [hasSpec, hasDesign, hasTestPlan, hasRoadmap, hasContext, hasHardware] =
		await Promise.all([
			fileExists(specPath),
			fileExists(designPath),
			fileExists(testPlanPath),
			fileExists(roadmapPath),
			fileExists(contextPath),
			fileExists(hardwarePath),
		]);

	let progress = 0;
	let blockers: string[] = [];
	let nextAction: string | undefined;
	let lastModified: Date | undefined;
	let techStack: TechStack | undefined;

	// 技術スタックの検出
	if (hasHardware) {
		techStack = "hardware";
	} else if (hasDesign) {
		const designContent = await readFile(designPath);
		if (
			designContent.includes("FastAPI") ||
			designContent.includes("Django") ||
			designContent.includes("Flask")
		) {
			techStack = "python";
		} else if (
			designContent.includes("Gin") ||
			designContent.includes("Echo")
		) {
			techStack = "go";
		} else if (
			designContent.includes("Actix-web") ||
			designContent.includes("Rocket")
		) {
			techStack = "rust";
		} else if (
			designContent.includes("Expo") ||
			designContent.includes("Hono") ||
			designContent.includes("Next.js")
		) {
			techStack = "typescript-web";
		}
	}

	if (hasRoadmap) {
		const roadmapContent = await readFile(roadmapPath);
		const roadmapData = parseRoadmap(roadmapContent);
		progress = roadmapData.progress;
		blockers = roadmapData.blockers;
	}

	if (hasContext) {
		const contextContent = await readFile(contextPath);
		const contextData = parseContext(contextContent);
		nextAction = contextData.nextActions[0];
		lastModified = await getFileModifiedDate(contextPath);
	}

	return {
		name,
		path: featurePath,
		hasSpec,
		hasDesign,
		hasTestPlan,
		hasRoadmap,
		hasContext,
		hasHardware,
		techStack,
		progress,
		lastModified,
		nextAction,
		blockers,
	};
}

async function findFeatures(docsDevPath: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(docsDevPath, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(docsDevPath, entry.name));
	} catch {
		return [];
	}
}

// ===== コマンド実装 =====
async function commandSummary(docsDevPath: string): Promise<void> {
	console.log("📊 Dev Support - 進捗サマリー\n");

	const featurePaths = await findFeatures(docsDevPath);

	if (featurePaths.length === 0) {
		console.log("⚠️  機能が見つかりません。");
		console.log(`   パス: ${docsDevPath}`);
		return;
	}

	const features = await Promise.all(featurePaths.map(analyzeFeature));
	features.sort((a, b) => b.progress - a.progress);

	for (const feature of features) {
		const progressBar =
			"█".repeat(Math.floor(feature.progress / 5)) +
			"░".repeat(20 - Math.floor(feature.progress / 5));

		const stackEmoji =
			feature.techStack === "hardware"
				? "⚡"
				: feature.techStack === "python"
					? "🐍"
					: feature.techStack === "go"
						? "🔷"
						: feature.techStack === "rust"
							? "🦀"
							: feature.techStack === "typescript-web"
								? "📱"
								: "📁";

		console.log(
			`\n${stackEmoji} ${feature.name}${feature.techStack ? ` (${feature.techStack})` : ""}`,
		);
		console.log(`   進捗: [${progressBar}] ${feature.progress}%`);

		const docs = [];
		if (feature.hasSpec) docs.push("SPEC");
		if (feature.hasDesign) docs.push("DESIGN");
		if (feature.hasTestPlan) docs.push("TEST");
		if (feature.hasRoadmap) docs.push("ROADMAP");
		if (feature.hasContext) docs.push("CONTEXT");
		if (feature.hasHardware) docs.push("HARDWARE");
		console.log(`   ドキュメント: ${docs.join(", ") || "なし"}`);

		if (feature.lastModified) {
			console.log(
				`   最終更新: ${feature.lastModified.toLocaleString("ja-JP")}`,
			);
		}

		if (feature.nextAction) {
			console.log(`   次のアクション: ${feature.nextAction}`);
		}

		if (feature.blockers.length > 0) {
			console.log(`   ⚠️  ブロッカー: ${feature.blockers.length}件`);
		}
	}

	console.log("\n");
}

async function commandDetail(
	docsDevPath: string,
	featureName: string,
): Promise<void> {
	const featurePath = path.join(docsDevPath, featureName);

	if (!(await fileExists(featurePath))) {
		console.error(`❌ 機能が見つかりません: ${featureName}`);
		return;
	}

	const feature = await analyzeFeature(featurePath);

	console.log(`\n📁 ${feature.name} - 詳細\n`);
	console.log(`進捗: ${feature.progress}%`);
	console.log(`パス: ${feature.path}\n`);

	console.log("ドキュメント:");
	console.log(`  - SPEC.md:      ${feature.hasSpec ? "✅" : "❌"}`);
	console.log(`  - DESIGN.md:    ${feature.hasDesign ? "✅" : "❌"}`);
	console.log(`  - TEST_PLAN.md: ${feature.hasTestPlan ? "✅" : "❌"}`);
	console.log(`  - ROADMAP.md:   ${feature.hasRoadmap ? "✅" : "❌"}`);
	console.log(`  - CONTEXT.md:   ${feature.hasContext ? "✅" : "❌"}`);
	if (feature.hasHardware) {
		console.log(`  - HARDWARE.md:  ✅`);
	}
	console.log();

	if (feature.hasContext) {
		const contextPath = path.join(featurePath, "CONTEXT.md");
		const contextContent = await readFile(contextPath);
		const contextData = parseContext(contextContent);

		if (contextData.lastWorkDate) {
			console.log(`最終作業日時: ${contextData.lastWorkDate}`);
		}
		if (contextData.currentTask) {
			console.log(`現在のタスク: ${contextData.currentTask}`);
		}
		if (contextData.nextActions.length > 0) {
			console.log("\n次回セッションでやること:");
			contextData.nextActions.forEach((action, i) => {
				console.log(`  ${i + 1}. ${action}`);
			});
		}
	}

	if (feature.blockers.length > 0) {
		console.log("\n⚠️  ブロッカー:");
		feature.blockers.forEach((blocker) => {
			console.log(`  - ${blocker}`);
		});
	}

	console.log("\n");
}

async function commandInit(
	docsDevPath: string,
	featureName: string,
	stack: TechStack = "typescript-web",
	templateName?: string,
): Promise<void> {
	const featurePath = path.join(docsDevPath, featureName);

	if (await fileExists(featurePath)) {
		console.error(`❌ 機能は既に存在します: ${featureName}`);
		return;
	}

	const stackEmoji =
		stack === "hardware"
			? "⚡"
			: stack === "python"
				? "🐍"
				: stack === "go"
					? "🔷"
					: stack === "rust"
						? "🦀"
						: "📱";

	// テンプレートリポジトリを使用する場合
	if (templateName && TEMPLATE_REPOS[templateName]) {
		const template = TEMPLATE_REPOS[templateName];
		console.log(`📦 テンプレートを使用: ${template.name}`);
		console.log(`${stackEmoji} 新機能を初期化: ${featureName} (${stack})\n`);

		// プロジェクトルートにテンプレートをクローン
		const projectRoot = path.join(process.cwd(), featureName);

		try {
			console.log(`🔄 クローン中: ${template.url}...`);
			execSync(`git clone ${template.url} ${projectRoot}`, {
				stdio: "inherit",
			});

			// .gitディレクトリを削除して新規リポジトリとして扱えるようにする
			const gitDir = path.join(projectRoot, ".git");
			if (await fileExists(gitDir)) {
				await fs.rm(gitDir, { recursive: true, force: true });
				console.log(
					"✅ .gitディレクトリを削除（新規リポジトリとして初期化可能）",
				);
			}

			console.log(`✅ クローン完了: ${projectRoot}\n`);
		} catch (error) {
			console.error(`❌ クローンに失敗しました: ${error}`);
			return;
		}

		// ドキュメントディレクトリを作成
		await fs.mkdir(featurePath, { recursive: true });

		const templates = getTemplates(featureName, stack);

		// CONTEXT.mdにテンプレート情報を追加
		const contextTemplate = templates["CONTEXT.md"];
		const contextWithTemplate = contextTemplate.replace(
			"## 環境情報",
			`## プロジェクト情報
- テンプレート: ${template.name}
- リポジトリ: ${template.url}
- 初期化日: ${new Date().toISOString().split("T")[0]}
- プロジェクトパス: ${projectRoot}

## セットアップコマンド
\`\`\`bash
cd ${featureName}
${template.setupCommands.join("\n")}
\`\`\`

## 環境情報`,
		);
		templates["CONTEXT.md"] = contextWithTemplate;

		for (const [filename, content] of Object.entries(templates)) {
			const filePath = path.join(featurePath, filename);
			await fs.writeFile(filePath, content, "utf-8");
			console.log(`✅ ドキュメント作成: docs/dev/${featureName}/${filename}`);
		}

		console.log(`\n✨ 初期化完了！`);
		console.log(`\n📁 プロジェクト: ${projectRoot}`);
		console.log(`📄 ドキュメント: ${featurePath}`);
		console.log("\n次のステップ:");
		console.log(`1. cd ${featureName}`);
		console.log(`2. ${template.setupCommands[0]}`);
		console.log(`3. docs/dev/${featureName}/SPEC.mdを編集して要件を定義\n`);
		return;
	}

	// 通常の初期化（テンプレートなし）
	console.log(`${stackEmoji} 新機能を初期化: ${featureName} (${stack})\n`);

	await fs.mkdir(featurePath, { recursive: true });

	const templates = getTemplates(featureName, stack);

	// .meta.json作成（スタック情報を明示的に記録）
	const metaData = {
		feature: featureName,
		stack: stack,
		createdAt: new Date().toISOString(),
		version: "1.0.0",
	};
	await fs.writeFile(
		path.join(featurePath, ".meta.json"),
		JSON.stringify(metaData, null, 2),
		"utf-8",
	);
	console.log(`✅ 作成: .meta.json`);

	for (const [filename, content] of Object.entries(templates)) {
		const filePath = path.join(featurePath, filename);
		await fs.writeFile(filePath, content, "utf-8");
		console.log(`✅ 作成: ${filename}`);
	}

	console.log(`\n✨ 初期化完了: ${featurePath}`);
	console.log("\n次のステップ:");
	console.log("1. SPEC.mdを編集して要件を定義");
	console.log("2. DESIGN.mdでアーキテクチャを設計");
	if (stack === "hardware") {
		console.log("3. HARDWARE.mdで回路図と部品リストを作成");
	}
	console.log("3. ROADMAP.mdで実装計画を立案\n");
}

function getTemplates(
	featureName: string,
	stack: TechStack,
): Record<string, string> {
	const baseTemplates = {
		"SPEC.md": `# ${featureName} 仕様書

## 目的
[この機能の目的を記述]

## 要件
### 機能要件
1. [要件1]
2. [要件2]

### 非機能要件
- パフォーマンス: [基準]
- セキュリティ: [考慮事項]

## ユーザーストーリー
As a [ユーザー種別]
I want to [やりたいこと]
So that [得られる価値]

## 受け入れ基準
- [ ] [基準1]
- [ ] [基準2]

## 制約事項
- [制約1]
`,

		"TEST_PLAN.md": `# ${featureName} テスト計画

## テスト戦略
- 単体テスト: [方針]
- 統合テスト: [方針]
- E2Eテスト: [方針]

## テストケース
### 正常系
| ID | ケース | 入力 | 期待結果 | 状態 |
|----|--------|------|----------|------|
| TC001 | [ケース名] | [入力] | [期待結果] | [ ] |

### 異常系
| ID | ケース | 入力 | 期待結果 | 状態 |
|----|--------|------|----------|------|
| TC101 | [ケース名] | [入力] | [期待結果] | [ ] |

## 検証環境
- [環境詳細]
`,

		"ROADMAP.md": `# ${featureName} ロードマップ

## マイルストーン
### Phase 1: 基本実装
- [ ] [タスク1] (見積: 30分)
- [ ] [タスク2] (見積: 30分)
- **完了予定**: [日付]

### Phase 2: 機能拡張
- [ ] [タスク1] (見積: 30分)
- **完了予定**: [日付]

## 進捗状況
- **全体進捗**: 0% (0/4 タスク完了)
- **現在フェーズ**: Phase 1
- **最終更新**: ${new Date().toISOString().split("T")[0]}

## ブロッカー
なし

## 完了済みタスク
なし
`,

		"CONTEXT.md": `# ${featureName} 作業コンテキスト

## 最終作業日時
[YYYY-MM-DD HH:MM]

## 現在の状況
### 作業中のタスク
[初期化完了 - 仕様策定から開始]

### 進捗状況
- 完了: スカフォールディング
- 進行中: なし
- 未着手: すべてのフェーズ

## 次回セッションでやること
1. SPEC.mdで機能要件を定義する - 優先度: 高
2. DESIGN.mdでアーキテクチャを設計する - 優先度: 高
3. TEST_PLAN.mdでテスト方針を策定する - 優先度: 中

## 技術的メモ
### 解決済み課題
なし

### 未解決課題
なし

### 重要な発見
なし

## ファイル変更履歴
- 初期ファイル生成

## 環境復元
### セットアップコマンド
\`\`\`bash
# 依存関係のインストール
[インストールコマンドを記録]

# 環境変数
[必要な環境変数を記録]

# その他の初期化
[その他のセットアップ手順]
\`\`\`

### 実行環境
- Node.js: [バージョン]
- Python: [バージョン]
- その他: [ツール/バージョン]

### ハードウェア状態（電子工作の場合）
- GPIO5: LED接続済み
- GPIO18: [状態]
- [その他の配線状態]

## 環境情報
- ブランチ: [ブランチ名]
- 最終コミット: [コミットハッシュ]

## メンタルモデル
[この機能の核心的なコンセプトをメモ]
`,
	};

	// 技術スタック別のDESIGN.mdテンプレート
	const designTemplates: Record<TechStack, string> = {
		"typescript-web": `# ${featureName} 設計書

## アーキテクチャ概要
[システム全体における位置づけ]

## コンポーネント構成
### フロントエンド (Expo/React/Next.js)
- **Component**: [コンポーネント名]
  - 責務: [責務]
  - Props: [Props定義]
  - State: [State管理]

### バックエンド (Hono/Node.js)
- **Endpoint**: \`[METHOD] /api/path\`
  - Request: \`{ ... }\`
  - Response: \`{ ... }\`
  - 認証: [要/不要]

## データフロー
1. [ステップ1]
2. [ステップ2]

## 技術的決定事項
- TypeScript: 厳格な型チェック
- [決定2]: [理由]

## 依存関係
- \`@hono/hono\`: 最新 - バックエンドフレームワーク
- \`expo\`: ^50.0.0 - モバイルフレームワーク
`,

		python: `# ${featureName} 設計書

## アーキテクチャ概要
[システム全体における位置づけ]

## モジュール構成
### API (FastAPI/Django/Flask)
- **Endpoint**: \`[METHOD] /api/v1/resource\`
  - Request Model: \`class RequestModel(BaseModel)\`
  - Response Model: \`class ResponseModel(BaseModel)\`
  - 依存注入: [Depends関数]

### データ処理
- **モジュール**: \`data_processor.py\`
  - 関数: \`process_data(input: DataFrame) -> DataFrame\`
  - ライブラリ: pandas, numpy

## データフロー
1. リクエスト受信 → バリデーション
2. ビジネスロジック実行
3. レスポンス返却

## 技術的決定事項
- 型ヒント: 全関数に必須
- 非同期処理: async/await使用
- [決定3]: [理由]

## 依存関係
- \`fastapi\`: ^0.109.0 - Webフレームワーク
- \`pydantic\`: ^2.0.0 - バリデーション
- \`sqlalchemy\`: ^2.0.0 - ORM
`,

		go: `# ${featureName} 設計書

## アーキテクチャ概要
[システム全体における位置づけ]

## パッケージ構成
### HTTP Handler (Gin/Echo)
- **Endpoint**: \`[METHOD] /api/resource\`
  - Handler: \`func HandleResource(c *gin.Context)\`
  - Request: \`type RequestDTO struct\`
  - Response: \`type ResponseDTO struct\`

### ドメインロジック
- **Service**: \`type ResourceService interface\`
  - メソッド: \`Process(ctx context.Context, input Input) (Output, error)\`

## データフロー
1. HTTPリクエスト → ハンドラー
2. サービス層で処理
3. リポジトリでデータ永続化

## 技術的決定事項
- エラーハンドリング: カスタムエラー型を使用
- 並行処理: goroutineとchannelを活用
- [決定3]: [理由]

## 依存関係
- \`github.com/gin-gonic/gin\`: v1.9+ - Webフレームワーク
- \`gorm.io/gorm\`: v1.25+ - ORM
`,

		rust: `# ${featureName} 設計書

## アーキテクチャ概要
[システム全体における位置づけ]

## モジュール構成
### Web Server (Actix-web/Rocket)
- **Route**: \`[METHOD] /api/resource\`
  - Handler: \`async fn handle_resource(...) -> Result<Json<Response>, Error>\`
  - Request: \`struct RequestDto\`
  - Response: \`struct ResponseDto\`

### ドメインロジック
- **Service**: \`trait ResourceService\`
  - メソッド: \`async fn process(&self, input: Input) -> Result<Output, AppError>\`

## データフロー
1. HTTPリクエスト → ハンドラー
2. サービス層で処理（所有権管理）
3. リポジトリでデータ操作

## 技術的決定事項
- エラー型: \`thiserror\` または \`anyhow\` 使用
- 非同期ランタイム: tokio
- 所有権設計: [方針]

## 依存関係
- \`actix-web\`: 4.x - Webフレームワーク
- \`tokio\`: 1.x - 非同期ランタイム
- \`serde\`: 1.x - シリアライズ
`,

		hardware: `# ${featureName} 設計書

## システム概要
[ハードウェアとソフトウェアの統合システム]

## ソフトウェア構成
### マイコンプログラム
- **メインループ**: \`void loop()\` / \`async fn main_loop()\`
  - センサー読み取り
  - データ処理
  - 通信・制御

### 通信プロトコル
- **方式**: UART / I2C / SPI / WiFi / BLE
- **データ形式**: [JSON/バイナリ/etc]

## ピン配置・接続
- GPIO X: [センサー/アクチュエータ接続]
- GPIO Y: [用途]

## データフロー
1. センサーからデータ取得
2. マイコンで処理・判断
3. アクチュエータ制御 / データ送信

## 技術的決定事項
- 開発環境: Arduino IDE / PlatformIO / Rust embedded
- 通信方式: [理由]
- 電源管理: [戦略]

## 依存ライブラリ
- [ライブラリ名]: [バージョン] - [用途]
`,
	};

	const templates: Record<string, string> = {
		...baseTemplates,
		"DESIGN.md": designTemplates[stack],
	};

	// ハードウェアスタックの場合はHARDWARE.mdを追加
	if (stack === "hardware") {
		templates["HARDWARE.md"] = `# ${featureName} ハードウェア仕様

## 回路図
[回路図へのリンクまたは説明]

## 部品リスト (BOM)
| 部品名 | 型番 | 数量 | 価格 | 購入先 | 備考 |
|--------|------|------|------|--------|------|
| マイコン | ESP32-DevKitC | 1 | ¥1,000 | 秋月電子 | WiFi/BLE対応 |
| センサー | [型番] | 1 | [価格] | [購入先] | [備考] |

## 配線図
### 接続詳細
\`\`\`
ESP32        センサー
GND    <-->  GND
3.3V   <-->  VCC
GPIO21 <-->  SDA
GPIO22 <-->  SCL
\`\`\`

## ピン配置
| ピン番号 | 機能 | 接続先 | 備考 |
|----------|------|--------|------|
| GPIO21 | I2C SDA | センサーSDA | プルアップ抵抗必要 |
| GPIO22 | I2C SCL | センサーSCL | プルアップ抵抗必要 |

## 電源要件
- 入力電圧: 5V (USB給電)
- 消費電流: 最大 200mA
- バッテリー動作: [対応/非対応]

## 動作環境
- 温度範囲: -10℃ ~ 50℃
- 湿度範囲: 20% ~ 80%
- 設置場所: 屋内

## 注意事項
- [注意1]
- [注意2]
`;
	}

	return templates;
}

// ===== メイン処理 =====
async function main() {
	await loadTemplates();
	const args = process.argv.slice(2);
	const command = args[0];
	const docsDevPath = path.join(process.cwd(), "docs", "dev");

	if (!command) {
		console.log("使用方法:");
		console.log(
			"  summary                            全機能の進捗サマリーを表示",
		);
		console.log("  detail <feature>                   特定機能の詳細を表示");
		console.log("  init <feature> [stack] [--template <name>]  新機能を初期化");
		console.log("");
		console.log("利用可能なスタック:");
		console.log(
			"  typescript-web (デフォルト)  TypeScript Web/Mobile (Expo, Hono, Next.js)",
		);
		console.log(
			"  python                      Python (FastAPI, Django, Flask)",
		);
		console.log("  go                          Go (Gin, Echo, CLI)");
		console.log(
			"  rust                        Rust (Actix-web, システムプログラミング)",
		);
		console.log(
			"  hardware                    電子工作 (Arduino, ESP32, Raspberry Pi)",
		);
		console.log("");
		console.log("利用可能なテンプレート:");
		Object.entries(TEMPLATE_REPOS).forEach(([key, template]) => {
			console.log(`  ${key.padEnd(20)} ${template.description}`);
		});
		process.exit(1);
	}

	switch (command) {
		case "summary":
			await commandSummary(docsDevPath);
			break;

		case "detail":
			if (!args[1]) {
				console.error("❌ 機能名を指定してください");
				process.exit(1);
			}
			await commandDetail(docsDevPath, args[1]);
			break;

		case "init": {
			if (!args[1]) {
				console.error("❌ 機能名を指定してください");
				process.exit(1);
			}

			// --templateオプションの解析
			let templateName: string | undefined;
			let stackArg = args[2];

			const templateIndex = args.indexOf("--template");
			if (templateIndex !== -1 && args[templateIndex + 1]) {
				templateName = args[templateIndex + 1];
				// --templateの前の引数をstackとして取得
				if (templateIndex === 2) {
					stackArg = undefined;
				}
			}

			const stack = (stackArg as TechStack) || "typescript-web";
			const validStacks: TechStack[] = [
				"typescript-web",
				"python",
				"go",
				"rust",
				"hardware",
			];
			if (stackArg && !validStacks.includes(stack)) {
				console.error(`❌ 不正なスタック: ${stackArg}`);
				console.error(`   利用可能: ${validStacks.join(", ")}`);
				process.exit(1);
			}

			if (templateName && !TEMPLATE_REPOS[templateName]) {
				console.error(`❌ 不正なテンプレート: ${templateName}`);
				console.error(`   利用可能: ${Object.keys(TEMPLATE_REPOS).join(", ")}`);
				process.exit(1);
			}

			await commandInit(docsDevPath, args[1], stack, templateName);
			break;
		}

		default:
			console.error(`❌ 不明なコマンド: ${command}`);
			process.exit(1);
	}
}

main().catch((error) => {
	console.error("エラー:", error);
	process.exit(1);
});
