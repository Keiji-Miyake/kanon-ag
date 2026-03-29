import { describe, it, expect } from 'vitest';
import { LoopWatchdog } from '../../../src/domain/services/loopWatchdog.js';

describe('LoopWatchdog', () => {
    const watchdog = new LoopWatchdog();

    it('異なる出力が続いた場合、false を返すこと', () => {
        expect(watchdog.isStalled('Output 1')).toBe(false);
        expect(watchdog.isStalled('Output 2')).toBe(false);
        expect(watchdog.isStalled('Output 1')).toBe(false);
    });

    it('3回連続で同一の出力（ハッシュ）があった場合、true を返すこと', () => {
        expect(watchdog.isStalled('Duplicate Output')).toBe(false); // 1回目
        expect(watchdog.isStalled('Duplicate Output')).toBe(false); // 2回目
        expect(watchdog.isStalled('Duplicate Output')).toBe(true);  // 3回目
    });

    it('連続が途切れた場合、カウントがリセットされること', () => {
        expect(watchdog.isStalled('Same')).toBe(false); // 1回目
        expect(watchdog.isStalled('Same')).toBe(false); // 2回目
        expect(watchdog.isStalled('Different')).toBe(false); // リセット
        expect(watchdog.isStalled('Same')).toBe(false); // 再び1回目
        expect(watchdog.isStalled('Same')).toBe(false); // 再び2回目
        expect(watchdog.isStalled('Same')).toBe(true);  // 再び3回目
    });

    it('閾値をカスタマイズできること', () => {
        const customWatchdog = new LoopWatchdog(2);
        expect(customWatchdog.isStalled('Quick Stall')).toBe(false); // 1回目
        expect(customWatchdog.isStalled('Quick Stall')).toBe(true);  // 2回目
    });
});
