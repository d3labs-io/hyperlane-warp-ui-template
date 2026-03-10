import type { Token, WarpCore } from '@hyperlane-xyz/sdk';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIndexForToken,
  getTokenByIndex,
  getTokenIndexFromChains,
  useTokens,
  useWarpCore,
} from '../hooks';

// Mock tokens for testing
const mockTokens: Token[] = [
  {
    name: 'Token A',
    symbol: 'TOKA',
    chainName: 'chain1',
    addressOrDenom: '0xtoken1',
    connections: [
      {
        token: {
          chainName: 'chain2',
          addressOrDenom: '0xtoken1-chain2',
        },
      },
    ],
  },
  {
    name: 'Token B',
    symbol: 'TOKB',
    chainName: 'chain1',
    addressOrDenom: '0xtoken2',
    connections: [
      {
        token: {
          chainName: 'chain2',
          addressOrDenom: '0xtoken2-chain2',
        },
      },
    ],
  },
] as Token[];

const mockWarpCore = {
  tokens: mockTokens,
  findToken: vi.fn(),
  getTokensForRoute: vi.fn(),
} as any;

// Mock the store module
vi.mock('../../store', () => ({
  useStore: (selector: (state: any) => unknown) => selector({ warpCore: mockWarpCore }),
}));

describe('Token Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useWarpCore', () => {
    it('returns warpCore from store', () => {
      const { result } = renderHook(() => useWarpCore());
      expect(result.current).toBe(mockWarpCore);
    });
  });

  describe('useTokens', () => {
    it('returns tokens from warpCore', () => {
      const { result } = renderHook(() => useTokens());
      expect(result.current).toBe(mockTokens);
    });
  });

  describe('useTokenByIndex', () => {
    it('returns the correct token for a valid index', () => {
      const { result } = renderHook(() => {
        const warpCore = useWarpCore();
        return getTokenByIndex(warpCore as WarpCore, 0);
      });
      expect(result.current).toBe(mockTokens[0]);
    });

    it('returns undefined for an invalid index', () => {
      const { result } = renderHook(() => {
        const warpCore = useWarpCore();
        return getTokenByIndex(warpCore as WarpCore, 10);
      });
      expect(result.current).toBeUndefined();
    });
  });

  describe('getTokenByIndex', () => {
    it('returns the correct token for a valid index', () => {
      const token = getTokenByIndex(mockWarpCore as WarpCore, 1);
      expect(token).toBe(mockTokens[1]);
    });
    it('returns undefined for an invalid index', () => {
      const token = getTokenByIndex(mockWarpCore as WarpCore, 5);
      expect(token).toBeUndefined();
    });
  });

  describe('getIndexForToken', () => {
    it('returns the correct index for a valid token', () => {
      const index = getIndexForToken(mockWarpCore as WarpCore, mockTokens[0]);
      expect(index).toBe(0);
    });
    it('returns undefined for a token not in the list', () => {
      const fakeToken = {
        name: 'Fake Token',
        symbol: 'FAKE',
        chainName: 'chainX',
        addressOrDenom: '0xfake',
      } as Token;
      const index = getIndexForToken(mockWarpCore as WarpCore, fakeToken);
      expect(index).toBeUndefined();
    });
  });

  describe('tryFindToken', () => {
    it('returns the token if found', () => {
      mockWarpCore.findToken?.mockReturnValueOnce(mockTokens[0]);
      const token = mockWarpCore.findToken?.('chain1', '0xtoken1');
      expect(token).toBe(mockTokens[0]);
    });
    it('returns null if token is not found', () => {
      mockWarpCore.findToken?.mockReturnValueOnce(null);
      const token = mockWarpCore.findToken?.('chainX', '0xfake');
      expect(token).toBeNull();
    });
  });

  describe('getTokenIndexFromChains', () => {
    it('returns the correct index when addressOrDenom matches a token in the route', () => {
      mockWarpCore.getTokensForRoute.mockReturnValueOnce([mockTokens[0]]);
      const index = getTokenIndexFromChains(mockWarpCore as WarpCore, '0xtoken1', 'chain1', 'chain2');
      expect(index).toBe(0);
    });

    it('auto-selects when there is exactly one token on the route and addressOrDenom is null', () => {
      mockWarpCore.getTokensForRoute.mockReturnValueOnce([mockTokens[0]]);
      const index = getTokenIndexFromChains(mockWarpCore as WarpCore, null, 'chain1', 'chain2');
      expect(index).toBe(0);
    });

    it('returns undefined when multiple tokens are on the route and addressOrDenom is null', () => {
      // Mirrors the bug: kairos->pruvtest has both USDT and MOCKRWA
      mockWarpCore.getTokensForRoute.mockReturnValueOnce([...mockTokens]);
      const index = getTokenIndexFromChains(mockWarpCore as WarpCore, null, 'chain1', 'chain2');
      expect(index).toBeUndefined();
    });

    it('returns the correct index when multiple tokens are on the route but addressOrDenom matches one', () => {
      // Mirrors the fix: swap button passes destinationToken.addressOrDenom so the
      // correct token is identified even when multiple tokens share the same route
      mockWarpCore.getTokensForRoute.mockReturnValueOnce([...mockTokens]);
      const index = getTokenIndexFromChains(mockWarpCore as WarpCore, '0xtoken2', 'chain1', 'chain2');
      expect(index).toBe(1);
    });

    it('returns undefined when addressOrDenom does not match any token in the route', () => {
      mockWarpCore.getTokensForRoute.mockReturnValueOnce([...mockTokens]);
      const index = getTokenIndexFromChains(mockWarpCore as WarpCore, '0xnonexistent', 'chain1', 'chain2');
      expect(index).toBeUndefined();
    });
  });
});
