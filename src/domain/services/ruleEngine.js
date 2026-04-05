export class RuleEngine {
    /**
     * エージェントの出力から `json:passage-result` ブロックを抽出し、
     * Passage に定義されたルール、または JSON 内の next_passage フィールドに基づき
     * 次の Passage 名を決定します。
     */
    determineNextPassage(output, currentPassage) {
        // Find json:passage-result code block
        const regex = /```json:passage-result\s+([\s\S]*?)\s+```/g;
        const match = regex.exec(output);
        if (!match) {
            return null;
        }
        try {
            const data = JSON.parse(match[1]);
            // 1. Passage に定義されたルールを優先評価
            if (currentPassage?.rules) {
                for (const rule of currentPassage.rules) {
                    if (this.evaluateRule(rule, data)) {
                        return rule.next;
                    }
                }
            }
            // 2. ルールに合致しない場合、またはルール未定義の場合、JSON 内の next_passage を返す
            return data.next_passage || null;
        }
        catch (e) {
            // JSON パースエラー等の場合は null を返す
            return null;
        }
    }
    /**
     * 単一のルールをデータに対して評価します。
     */
    evaluateRule(rule, data) {
        const { field, operator, value } = rule.condition;
        // 指定されたフィールドの値を取得
        const fieldValue = this.getFieldValue(data, field);
        switch (operator) {
            case 'eq':
                return fieldValue === value;
            case 'neq':
                return fieldValue !== value;
            case 'contains':
                if (typeof fieldValue === 'string') {
                    return fieldValue.includes(String(value));
                }
                if (Array.isArray(fieldValue)) {
                    return fieldValue.includes(value);
                }
                return false;
            case 'gt':
                return fieldValue > value;
            case 'lt':
                return fieldValue < value;
            default:
                return false;
        }
    }
    /**
     * ドット記法によるネストされたフィールドの取得に対応します。
     * セキュリティ対策として、`__proto__`, `constructor`, `prototype` へのアクセスをブロックします。
     */
    getFieldValue(data, path) {
        if (!path)
            return data;
        const segments = path.split('.');
        let current = data;
        for (const segment of segments) {
            // プロトタイプ汚染対策
            if (['__proto__', 'constructor', 'prototype'].includes(segment)) {
                return undefined;
            }
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = current[segment];
        }
        return current;
    }
}
