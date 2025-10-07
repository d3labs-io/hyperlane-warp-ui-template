import { describe, expect, it } from 'vitest';
import { formatTimestamp } from '../date';

describe('formatTimestamp', () => {
  it('should format a valid timestamp correctly', () => {
    const timestamp = 1697040000000; // Example timestamp
    const result = formatTimestamp(timestamp);
    const date = new Date(timestamp);
    const expected = `${date.toLocaleTimeString()} ${date.toLocaleDateString()}`;
    expect(result).toBe(expected);
  });

  it('should handle invalid timestamps gracefully', () => {
    const invalidTimestamp = 'invalid';
    expect(() => formatTimestamp(Number(invalidTimestamp))).toThrowError('Invalid timestamp');
  });
});
