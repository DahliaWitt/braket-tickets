import { describe, it, expect } from 'vitest';
import { computePricingStats } from './stats';

describe('computePricingStats', () => {
  it('returns correct stats for multiple values', () => {
    const result = computePricingStats([500, 1000, 1000, 1500, 2500]);
    expect(result).toEqual({
      count: 5,
      min: 500,
      max: 2500,
      mean: 1300,
      median: 1000,
      mode: [1000],
    });
  });

  it('returns correct median for even count', () => {
    const result = computePricingStats([500, 1000, 1500, 2000]);
    expect(result).toEqual({
      count: 4,
      min: 500,
      max: 2000,
      mean: 1250,
      median: 1250,
      mode: [500, 1000, 1500, 2000], // all tied at frequency 1
    });
  });

  it('returns all tied mode values sorted ascending', () => {
    const result = computePricingStats([500, 500, 1000, 1000, 2000]);
    expect(result).toEqual({
      count: 5,
      min: 500,
      max: 2000,
      mean: 1000,
      median: 1000,
      mode: [500, 1000], // both appear twice
    });
  });

  it('handles single value', () => {
    const result = computePricingStats([750]);
    expect(result).toEqual({
      count: 1,
      min: 750,
      max: 750,
      mean: 750,
      median: 750,
      mode: [750],
    });
  });

  it('rounds median to nearest cent for odd-sum middle pair', () => {
    const result = computePricingStats([500, 1001]);
    expect(result).toEqual({
      count: 2,
      min: 500,
      max: 1001,
      mean: 751,
      median: 751, // (500 + 1001) / 2 = 750.5, rounded to 751
      mode: [500, 1001],
    });
  });

  it('returns null for empty array', () => {
    const result = computePricingStats([]);
    expect(result).toBeNull();
  });
});
