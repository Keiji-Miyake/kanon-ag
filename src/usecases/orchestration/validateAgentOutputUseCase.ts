import { OutputContract } from '../../domain/models/promptFacet.js';
import { ValidationResult } from '../../domain/models/validation.js';
import { OutputValidationService } from '../../domain/services/outputValidationService.js';
import { IOutputValidator } from '../../domain/services/outputValidator.js';

export class ValidateAgentOutputUseCase {
    private validationService: OutputValidationService;

    constructor(jsonValidator: IOutputValidator) {
        this.validationService = new OutputValidationService(jsonValidator);
    }

    /**
     * エージェントの出力を検証する
     */
    public async execute(output: string, contract: OutputContract): Promise<ValidationResult> {
        return this.validationService.validate(output, contract);
    }
}
