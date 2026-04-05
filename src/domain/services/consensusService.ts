export interface AgentOutput {
    skill: string;
    output: string;
    consensusReached?: boolean;
}

export class ConsensusService {
    /**
     * Supervisor 向けに全エージェントの出力を統合したプロンプトを構築する。
     */
    public buildSupervisorPrompt(outputs: AgentOutput[]): string {
        const sections = outputs.map(out => `## Output from ${out.skill}\n${out.output}`);
        
        return `
# Consensus Deliberation
Multiple agents have provided their analysis. Your task is to aggregate these perspectives and decide the next step.

${sections.join('\n\n')}

# Final Decision Requirement
You MUST output the final decision in the following format:

\`\`\`json:passage-result
{
  "next_passage": "NAME_OF_NEXT_PASSAGE",
  "reason": "Summary of consensus or rationale for the decision"
}
\`\`\`

If a consensus cannot be reached and more deliberation is needed, you may specify a special passage or null if you want to abort.
`;
    }

    /**
     * 再審議（Deliberation）のために、他のエージェントの意見をフィードバックとして構築する。
     */
    public buildDeliberationFeedback(targetSkill: string, allOutputs: AgentOutput[]): string {
        const otherOutputs = allOutputs.filter(out => out.skill !== targetSkill);
        const sections = otherOutputs.map(out => `### Output from ${out.skill}\n${out.output}`);

        return `
# Deliberation Feedback
You are part of a consensus group. Other agents provided the following feedback on the task. Please review their perspectives and refine your own output if necessary.

${sections.join('\n\n')}

Please provide your updated analysis considering these points.
`;
    }
}
