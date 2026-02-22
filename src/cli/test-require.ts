
// import * as path from 'path';
import * as agentSpawner from './agent-spawner.js';
import * as cliResolver from './cli-resolver.js';
import * as memoryManager from './memory-manager.js';

console.log('agentSpawner keys:', Object.keys(agentSpawner));
console.log('cliResolver keys:', Object.keys(cliResolver));
console.log('memoryManager keys:', Object.keys(memoryManager));

if (typeof (agentSpawner as any).spawnAgent === 'function') {
    console.log('✅ agentSpawner.spawnAgent is function');
} else {
    console.error('❌ agentSpawner.spawnAgent is NOT function');
}
