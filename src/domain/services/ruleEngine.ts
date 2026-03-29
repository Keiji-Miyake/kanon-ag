export class RuleEngine {
    public determineNextPassage(output: string): string | null {
        // Find json:passage-result code block
        const regex = /```json:passage-result\s+([\s\S]*?)\s+```/g;
        const match = regex.exec(output);
        if (!match) {
            return null;
        }

        try {
            const result = JSON.parse(match[1]);
            return result.next_passage || null;
        } catch (e) {
            return null;
        }
    }
}
