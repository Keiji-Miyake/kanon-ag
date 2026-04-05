import { AjvOutputValidator } from './src/infrastructure/validation/ajvOutputValidator.js';
import { OutputContract } from './src/domain/models/promptFacet.js';

async function test() {
    const validator = new AjvOutputValidator();
    
    const contract: OutputContract = {
        format: 'json',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['success', 'failure'] },
                result: { type: 'number' }
            },
            required: ['status', 'result']
        }
    };

    const validOutput = '```json\n{ "status": "success", "result": 42 }\n```';
    const result1 = await validator.validate(validOutput, contract);
    console.log('Result 1 (Valid):', JSON.stringify(result1, null, 2));

    const invalidOutput = '```json\n{ "status": "pending", "result": "forty-two" }\n```';
    const result2 = await validator.validate(invalidOutput, contract);
    console.log('Result 2 (Invalid):', JSON.stringify(result2, null, 2));

    const badJson = '```json\n{ "status": "success", "result": 42 \n```'; // Missing brace
    const result3 = await validator.validate(badJson, contract);
    console.log('Result 3 (Bad JSON):', JSON.stringify(result3, null, 2));
}

test().catch(console.error);
