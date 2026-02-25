import { describe, it, expect, beforeEach } from 'vitest';
import { Calculator } from '../src/calculator';

describe('Calculator', () => {
  let calculator: Calculator;

  beforeEach(() => {
    calculator = new Calculator();
  });

  describe('add', () => {
    it('should add two positive numbers', () => {
      expect(calculator.add(1, 2)).toBe(3);
    });

    it('should add negative numbers', () => {
      expect(calculator.add(-1, 5)).toBe(4);
    });

    it('should handle decimal addition', () => {
      expect(calculator.add(0.1, 0.2)).toBeCloseTo(0.3);
    });
  });

  describe('subtract', () => {
    it('should subtract two numbers', () => {
      expect(calculator.subtract(10, 4)).toBe(6);
    });

    it('should return negative result when subtracting larger from smaller', () => {
      expect(calculator.subtract(3, 5)).toBe(-2);
    });
  });

  describe('multiply', () => {
    it('should multiply two numbers', () => {
      expect(calculator.multiply(3, 4)).toBe(12);
    });

    it('should multiply by zero', () => {
      expect(calculator.multiply(5, 0)).toBe(0);
    });
  });

  describe('divide', () => {
    it('should divide two numbers', () => {
      expect(calculator.divide(10, 2)).toBe(5);
    });

    it('should return decimal results', () => {
      expect(calculator.divide(5, 2)).toBe(2.5);
    });

    it('should throw an error when dividing by zero', () => {
      expect(() => calculator.divide(10, 0)).toThrow('Division by zero');
    });
  });
});
