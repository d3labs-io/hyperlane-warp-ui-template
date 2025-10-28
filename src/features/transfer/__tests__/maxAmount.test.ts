import { existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('maxAmount', () => {
  it('should have maxAmount.ts file', () => {
    const filePath = join(__dirname, '../maxAmount.ts');
    expect(existsSync(filePath)).toBe(true);
  });
});
