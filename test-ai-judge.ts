import { OrchestrationService } from './src/usecases/orchestration/orchestrationService.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const originalScore = fs.readFileSync('score.json', 'utf-8');
    
    // Create a stalling score
    const stallScore = {
      "name": "Stall Test",
      "description": "A score designed to stall by repeating the same task.",
      "initialPassage": "repeat_task",
      "passages": [
        {
          "name": "repeat_task",
          "displayName": "Say 'Hello' repeatedly",
          "skill": "architect",
          "persona": "architect",
          "instruction": "Output exactly the following JSON and nothing else: \`\`\`json:passage-result {\"response\": \"Hello\"} \`\`\`",
          "next": "repeat_task"
        }
      ]
    };
    
    fs.writeFileSync('score.json', JSON.stringify(stallScore, null, 2));

    const logger = (msg: string, agent?: string, meta?: any) => {
        console.log(`[${agent || 'System'}] ${msg}`);
    };

    const service = new OrchestrationService(logger);

    try {
        console.log('🚀 Starting Orchestration Service with stalling score...');
        await service.runScore([]);
    } catch (e) {
        console.error('❌ Orchestration finished with error (expected if aborted or failed):', e);
    } finally {
        // Restore original score
        fs.writeFileSync('score.json', originalScore);
    }
}

main();
