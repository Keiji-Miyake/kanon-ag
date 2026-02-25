import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { YamlWorkflowParser } from '../../../src/infrastructure/config/yamlWorkflowParser.js';

describe('YamlWorkflowParser', () => {
    const parser = new YamlWorkflowParser();

    // テスト用の一時 YAML ファイルを作成するヘルパー
    async function writeTempYaml(content: string): Promise<string> {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanon-test-'));
        const filePath = path.join(tmpDir, 'workflow.yaml');
        await fs.writeFile(filePath, content, 'utf8');
        return filePath;
    }

    // =====================
    // 正常系
    // =====================
    it('有効な YAML を正しく StateNode の配列にパースする', async () => {
        const yaml = `
workflow:
  - id: implement
    description: コードを実装する
    agentsToRun:
      - developer
    transitions:
      - targetState: review
        condition: success
        action: notify
      - targetState: implement
        condition: failure
        action: retry
  - id: review
    description: コードをレビューする
    agentsToRun:
      - reviewer-a
      - reviewer-b
    aggregateCondition:
      type: all
      targetAgents:
        - reviewer-a
        - reviewer-b
    transitions:
      - targetState: deploy
        condition: success
    isTerminal: false
  - id: deploy
    description: デプロイする
    agentsToRun: []
    transitions: []
    isTerminal: true
`;
        const filePath = await writeTempYaml(yaml);
        const nodes = await parser.parse(filePath);

        expect(nodes).toHaveLength(3);

        // implement ノードの検証
        const implementNode = nodes[0];
        expect(implementNode.id).toBe('implement');
        expect(implementNode.description).toBe('コードを実装する');
        expect(implementNode.agentsToRun).toEqual(['developer']);
        expect(implementNode.transitions).toHaveLength(2);
        expect(implementNode.transitions[0].targetState).toBe('review');
        expect(implementNode.transitions[0].condition).toBe('success');
        expect(implementNode.transitions[0].action).toBe('notify');

        // review ノードの aggregateCondition 検証
        const reviewNode = nodes[1];
        expect(reviewNode.aggregateCondition).toBeDefined();
        expect(reviewNode.aggregateCondition?.type).toBe('all');
        expect(reviewNode.aggregateCondition?.targetAgents).toEqual(['reviewer-a', 'reviewer-b']);

        // deploy ノード（終端ノード）の検証
        const deployNode = nodes[2];
        expect(deployNode.isTerminal).toBe(true);
        expect(deployNode.transitions).toHaveLength(0);
    });

    it('オプションフィールド（aggregateCondition, action）が省略された場合もパースできる', async () => {
        const yaml = `
workflow:
  - id: simple_node
    agentsToRun: []
    transitions:
      - targetState: end
        condition: success
`;
        const filePath = await writeTempYaml(yaml);
        const nodes = await parser.parse(filePath);

        expect(nodes).toHaveLength(1);
        const node = nodes[0];
        expect(node.id).toBe('simple_node');
        expect(node.description).toBe(''); // デフォルト値
        expect(node.aggregateCondition).toBeUndefined();
        expect(node.isTerminal).toBe(false); // デフォルト値
        expect(node.transitions[0].action).toBeUndefined();
    });

    it('空の workflow 配列 → 空の配列を返す', async () => {
        const yaml = `workflow: []`;
        const filePath = await writeTempYaml(yaml);
        const nodes = await parser.parse(filePath);
        expect(nodes).toHaveLength(0);
    });

    // =====================
    // 異常系
    // =====================
    it('"workflow" キーが存在しない → エラーをスロー', async () => {
        const yaml = `states: []`;
        const filePath = await writeTempYaml(yaml);
        await expect(parser.parse(filePath)).rejects.toThrow('Invalid workflow YAML format');
    });

    it('"workflow" が配列でない → エラーをスロー', async () => {
        const yaml = `workflow: not_an_array`;
        const filePath = await writeTempYaml(yaml);
        await expect(parser.parse(filePath)).rejects.toThrow('Invalid workflow YAML format');
    });

    it('ファイルが存在しない → エラーをスロー', async () => {
        await expect(parser.parse('/nonexistent/path/workflow.yaml')).rejects.toThrow();
    });
});
