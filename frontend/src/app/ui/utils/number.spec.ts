import { clamp, roundToStep, convertValueToPercentage } from './number';

describe('number utils', () => {
  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(5, [0, 10])).toBe(5);
      expect(clamp(0, [0, 10])).toBe(0);
      expect(clamp(10, [0, 10])).toBe(10);
    });

    it('should return min when value is below range', () => {
      expect(clamp(-5, [0, 10])).toBe(0);
      expect(clamp(-100, [0, 10])).toBe(0);
    });

    it('should return max when value is above range', () => {
      expect(clamp(15, [0, 10])).toBe(10);
      expect(clamp(100, [0, 10])).toBe(10);
    });

    it('should work with negative ranges', () => {
      expect(clamp(-5, [-10, -1])).toBe(-5);
      expect(clamp(0, [-10, -1])).toBe(-1);
      expect(clamp(-15, [-10, -1])).toBe(-10);
    });

    it('should work with decimal values', () => {
      expect(clamp(0.5, [0, 1])).toBe(0.5);
      expect(clamp(1.5, [0, 1])).toBe(1);
      expect(clamp(-0.5, [0, 1])).toBe(0);
    });

    it('should handle single-value range (min === max)', () => {
      expect(clamp(5, [3, 3])).toBe(3);
      expect(clamp(0, [3, 3])).toBe(3);
    });
  });

  describe('roundToStep', () => {
    it('should round to nearest step from origin', () => {
      expect(roundToStep(7, 0, 5)).toBe(5);
      expect(roundToStep(8, 0, 5)).toBe(10);
      expect(roundToStep(7.5, 0, 5)).toBe(10); // midpoint rounds up
    });

    it('should respect min offset as step grid baseline', () => {
      // Step grid starts at 5: 5, 15, 25, 35...
      expect(roundToStep(12, 5, 10)).toBe(15);
      expect(roundToStep(8, 5, 10)).toBe(5);
      expect(roundToStep(20, 5, 10)).toBe(25);
    });

    it('should work with decimal steps', () => {
      expect(roundToStep(0.27, 0, 0.1)).toBeCloseTo(0.3, 10);
      expect(roundToStep(0.24, 0, 0.1)).toBeCloseTo(0.2, 10);
      expect(roundToStep(1.75, 0, 0.5)).toBeCloseTo(2.0, 10);
    });

    it('should handle step of 1', () => {
      expect(roundToStep(5.4, 0, 1)).toBe(5);
      expect(roundToStep(5.5, 0, 1)).toBe(6);
      expect(roundToStep(5.6, 0, 1)).toBe(6);
    });

    it('should work with negative values', () => {
      expect(roundToStep(-7, 0, 5)).toBe(-5);
      expect(roundToStep(-8, 0, 5)).toBe(-10);
    });

    it('should return exact value when already on step', () => {
      expect(roundToStep(10, 0, 5)).toBe(10);
      expect(roundToStep(15, 5, 10)).toBe(15);
    });
  });

  describe('convertValueToPercentage', () => {
    it('should return 0 at min value', () => {
      expect(convertValueToPercentage(0, 0, 100)).toBe(0);
      expect(convertValueToPercentage(10, 10, 20)).toBe(0);
    });

    it('should return 100 at max value', () => {
      expect(convertValueToPercentage(100, 0, 100)).toBe(100);
      expect(convertValueToPercentage(20, 10, 20)).toBe(100);
    });

    it('should return 50 at midpoint', () => {
      expect(convertValueToPercentage(50, 0, 100)).toBe(50);
      expect(convertValueToPercentage(15, 10, 20)).toBe(50);
    });

    it('should calculate correct percentage for arbitrary values', () => {
      expect(convertValueToPercentage(25, 0, 100)).toBe(25);
      expect(convertValueToPercentage(75, 0, 100)).toBe(75);
      expect(convertValueToPercentage(50, 0, 200)).toBe(25);
    });

    it('should work with negative ranges', () => {
      expect(convertValueToPercentage(-5, -10, 0)).toBe(50);
      expect(convertValueToPercentage(-10, -10, 0)).toBe(0);
      expect(convertValueToPercentage(0, -10, 0)).toBe(100);
    });

    it('should handle values outside range (extrapolation)', () => {
      expect(convertValueToPercentage(150, 0, 100)).toBe(150);
      expect(convertValueToPercentage(-50, 0, 100)).toBe(-50);
    });

    it('should work with decimal values', () => {
      expect(convertValueToPercentage(0.5, 0, 1)).toBe(50);
      expect(convertValueToPercentage(0.25, 0, 1)).toBe(25);
    });
  });
});
