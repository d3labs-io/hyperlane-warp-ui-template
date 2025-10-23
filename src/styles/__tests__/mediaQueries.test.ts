import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWindowSizeMobile, isWindowSizeSmallMobile } from '../mediaQueries';

// Mock window object
const mockWindow = {
  innerWidth: 1024,
  innerHeight: 768,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

Object.defineProperty(window, 'innerWidth', {
  writable: true,
  configurable: true,
  value: mockWindow.innerWidth,
});

Object.defineProperty(window, 'innerHeight', {
  writable: true,
  configurable: true,
  value: mockWindow.innerHeight,
});

Object.defineProperty(window, 'addEventListener', {
  writable: true,
  configurable: true,
  value: mockWindow.addEventListener,
});

Object.defineProperty(window, 'removeEventListener', {
  writable: true,
  configurable: true,
  value: mockWindow.removeEventListener,
});

describe('mediaQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  describe('isWindowSizeMobile', () => {
    it('should return true for width less than 768', () => {
      expect(isWindowSizeMobile(767)).toBe(true);
      expect(isWindowSizeMobile(500)).toBe(true);
      expect(isWindowSizeMobile(360)).toBe(true); // Edge case
    });

    it('should return false for width 768 or greater', () => {
      expect(isWindowSizeMobile(768)).toBe(false);
      expect(isWindowSizeMobile(1024)).toBe(false);
      expect(isWindowSizeMobile(1920)).toBe(false);
    });

    it('should return false for undefined width', () => {
      expect(isWindowSizeMobile(undefined)).toBe(false); // Assuming default is non-mobile
    });
  });

  describe('isWindowSizeSmallMobile', () => {
    it('should return true for width less than 360', () => {
      expect(isWindowSizeSmallMobile(359)).toBe(true);
      expect(isWindowSizeSmallMobile(320)).toBe(true);
      expect(isWindowSizeSmallMobile(200)).toBe(true);
    });

    it('should return false for width 360 or greater', () => {
      expect(isWindowSizeSmallMobile(360)).toBe(false);
      expect(isWindowSizeSmallMobile(768)).toBe(false);
      expect(isWindowSizeSmallMobile(1024)).toBe(false);
    });

    it('should return false for undefined width', () => {
      expect(isWindowSizeSmallMobile(undefined)).toBe(false); // Assuming default is non-small-mobile
    });
  });
});
