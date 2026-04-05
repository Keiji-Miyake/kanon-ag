import { OutputValidationService } from '../../domain/services/outputValidationService.js';
export class ValidateAgentOutputUseCase {
    validationService;
    constructor(jsonValidator) {
        this.validationService = new OutputValidationService(jsonValidator);
    }
    /**
     * エージェントの出力を検証する
     */
    async execute(output, contract) {
        return this.validationService.validate(output, contract);
    }
}
