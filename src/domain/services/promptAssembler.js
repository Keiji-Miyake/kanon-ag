import * as fs from 'fs';
import * as path from 'path';
export class PromptAssembler {
    facetsDir;
    constructor(facetsDir) {
        this.facetsDir = facetsDir;
    }
    async assemble(blueprint) {
        const sections = [];
        // 1. Persona
        if (blueprint.persona) {
            const content = this.readFacet('persona', blueprint.persona);
            if (content)
                sections.push(content);
        }
        // 2. Policies
        if (blueprint.policies) {
            for (const policy of blueprint.policies) {
                const content = this.readFacet('policy', policy);
                if (content)
                    sections.push(content);
            }
        }
        // 3. Knowledge
        if (blueprint.knowledge) {
            for (const k of blueprint.knowledge) {
                const content = this.readFacet('knowledge', k);
                if (content)
                    sections.push(content);
            }
        }
        // 4. Instruction (Inline)
        if (blueprint.instruction) {
            sections.push(`# Instructions\n${blueprint.instruction}`);
        }
        // 5. Output Contract
        if (blueprint.outputContract) {
            let contractMd = `# Output Requirements\n- **Format**: ${blueprint.outputContract.format}\n`;
            if (blueprint.outputContract.schema) {
                contractMd += `- **Schema**: \`\`\`json\n${JSON.stringify(blueprint.outputContract.schema, null, 2)}\n\`\`\`\n`;
            }
            if (blueprint.outputContract.example) {
                contractMd += `- **Example**: \n${blueprint.outputContract.example}\n`;
            }
            sections.push(contractMd);
        }
        return sections.join('\n\n---\n\n');
    }
    readFacet(type, name) {
        const filePath = path.join(this.facetsDir, type, `${name}.md`);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return fs.readFileSync(filePath, 'utf-8');
    }
}
