import { StateNode } from '../../domain/models/fsmNode.js';
import * as yaml from 'yaml';
import * as fs from 'fs/promises';

export class YamlWorkflowParser {
    /**
     * YAMLファイルからFSMのワークフロー定義を読み込み、StateNodeの配列として返却します。
     * @param filePath YAMLファイルの絶対パス
     */
    public async parse(filePath: string): Promise<StateNode[]> {
        const fileContent = await fs.readFile(filePath, 'utf8');
        const parsed = yaml.parse(fileContent);

        if (!parsed || !Array.isArray(parsed.workflow)) {
            throw new Error('Invalid workflow YAML format: missing "workflow" array.');
        }

        return parsed.workflow.map((node: any) => this.mapToStateNode(node));
    }

    /**
     * パースされた生データをドメインモデルである StateNode にマッピングします。
     */
    private mapToStateNode(node: any): StateNode {
        return {
            id: node.id,
            description: node.description || '',
            agentsToRun: node.agentsToRun || [],
            aggregateCondition: node.aggregateCondition ? {
                type: node.aggregateCondition.type,
                targetAgents: node.aggregateCondition.targetAgents || []
            } : undefined,
            transitions: (node.transitions || []).map((t: any) => ({
                targetState: t.targetState,
                condition: t.condition,
                action: t.action
            })),
            isTerminal: node.isTerminal === true
        };
    }
}
