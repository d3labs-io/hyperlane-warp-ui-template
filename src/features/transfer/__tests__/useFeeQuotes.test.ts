import { existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('useFeeQuotes', () => {
  it('should have useFeeQuotes.ts file', () => {
    const filePath = join(__dirname, '../useFeeQuotes.ts');
    expect(existsSync(filePath)).toBe(true);
  });
});
