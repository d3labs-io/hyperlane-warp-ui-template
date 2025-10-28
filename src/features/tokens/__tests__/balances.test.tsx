import { Token } from '@hyperlane-xyz/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach } from 'node:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDestinationNativeBalance,
  useBalance,
  useDestinationBalance,
  useOriginBalance,
} from '../balances';

const { mockTokens, mockWarpCore } = vi.hoisted(() => {
  const mockTokens: any[] = [
    {
      name: 'Token A',
      symbol: 'TOKA',
      chainName: 'chain1',
      addressOrDenom: '0xtoken1',
      getBalance: vi.fn().mockResolvedValue({ amount: '2000' }),
      getConnectionForChain: vi.fn().mockReturnValue({
        token: {
          getBalance: vi.fn().mockResolvedValue({ amount: '2000' }),
          chainName: 'chain2',
          addressOrDenom: '0xtoken1-chain2',
        },
      }),
      connections: [
        {
          token: {
            getBalance: vi.fn().mockResolvedValue({ amount: '2000' }),
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
  ];

  const mockWarpCore = {
    tokens: mockTokens,
    findToken: vi.fn(),
    getTokensForRoute: vi.fn(),
  } as any;

  return {
    mockWarpCore,
    mockTokens,
  };
});

vi.mock('@hyperlane-xyz/widgets', () => {
  return {
    useAccountAddressForChain: vi.fn().mockReturnValue('0xtoken1'),
  };
});

vi.mock('../../store', () => ({
  useStore: (selector: (state: any) => unknown) => selector({ warpCore: mockWarpCore }),
}));

// Create a wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

vi.mock('@hyperlane-xyz/utils', async () => {
  const actual = await vi.importActual<any>('@hyperlane-xyz/utils');
  return {
    ...actual,
    isValidAddress: vi.fn().mockReturnValue(true),
  };
});

vi.mock('../chains/hooks', () => ({
  useMultiProvider: () => ({
    getChainMetadata: vi.fn().mockReturnValue({ nativeToken: { addressOrDenom: '0xtoken1' } }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBalance', () => {
  it('returns balance data when available', async () => {
    const mockToken = {
      addressOrDenom: '0xtokenaddress',
      protocol: 'ethereum',
      getBalance: vi.fn().mockResolvedValue({ amount: '1000' }),
    };
    const { result } = renderHook(
      () => useBalance('ethereum', mockToken as any, '0xowneraddress'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toEqual({ amount: '1000' });
  });

  it('handles error when fetching balance', async () => {
    const mockToken = {
      addressOrDenom: '0xtokenaddress',
      protocol: 'ethereum',
      getBalance: vi.fn().mockRejectedValue(new Error('Failed to fetch balance')),
    };
    const { result } = renderHook(
      () => useBalance('ethereum', mockToken as any, '0xowneraddress'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.balance).toBeUndefined();
  });
});

describe('useOriginBalance', () => {
  it('returns origin balance data when available', async () => {
    const { result } = renderHook(
      () => useOriginBalance({ origin: 'chain1', tokenIndex: 0 } as any),
      {
        wrapper: createWrapper(),
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toEqual({ amount: '2000' });
  });

  it('handles error when fetching origin balance', async () => {
    const { result } = renderHook(
      () => useOriginBalance({ origin: 'ethereum', tokenIndex: 3 } as any),
      {
        wrapper: createWrapper(),
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBeUndefined();
  });
});

describe('useDestinationBalance', () => {
  it('returns destination balance data when available', async () => {
    const { result } = renderHook(
      () =>
        useDestinationBalance({
          destination: 'chain2',
          tokenIndex: 0,
          recipient: '0xrecipientaddress',
        } as any),
      {
        wrapper: createWrapper(),
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toEqual({ amount: '2000' });
  });

  it('handles error when fetching destination balance', async () => {
    const { result } = renderHook(
      () =>
        useDestinationBalance({
          destination: 'chain3',
          tokenIndex: 3,
          recipient: '0xrecipientaddress',
        } as any),
      {
        wrapper: createWrapper(),
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBeUndefined();
  });
});

describe('getDestinationNativeBalance', () => {
  afterEach(() => {
    vi.restoreAllMocks(); // Auto cleanup after each test
  });

  it('returns native balance when available', async () => {
    const mockMultiProvider = {
      tryGetChainMetadata: vi.fn().mockReturnValue({
        displayName: 'test',
        name: 'test',
        nativeToken: { addressOrDenom: '0xnative' },
      }),
      getChainMetadata: vi.fn().mockReturnValue({
        displayName: 'test',
        name: 'test',
        nativeToken: { addressOrDenom: '0xnative' },
      }),
    };

    vi.spyOn(Token, 'FromChainMetadataNativeToken').mockReturnValue(mockTokens[0]);

    const result = getDestinationNativeBalance(
      mockMultiProvider as any,
      { destination: 'chain1', recipient: '0xrecipientaddress' } as any,
    );
    await waitFor(() => expect(result).resolves.toBe('2000'));
  });

  it('handles error when fetching native balance', async () => {
    const mockMultiProvider = {
      tryGetChainMetadata: vi.fn().mockReturnValue({
        displayName: 'test',
        name: 'test',
        nativeToken: { addressOrDenom: '0xnative' },
      }),
      getChainMetadata: vi.fn().mockReturnValue({
        displayName: 'test',
        name: 'test',
        nativeToken: { addressOrDenom: '0xnative' },
      }),
    };

    vi.spyOn(Token, 'FromChainMetadataNativeToken').mockRejectedValue(new Error('Something wrong'));

    const result = getDestinationNativeBalance(
      mockMultiProvider as any,
      { destination: 'chain1', recipient: '0xrecipientaddress' } as any,
    );
    await waitFor(() => expect(result).resolves.toBeUndefined());
  });
});

// describe('useEvmWalletBalance', () => {
//   it('return undefined when allow refetch false', async () => {
//     const { result } = renderHook(() => useEvmWalletBalance('chain1', 100, 'token1', false));
//     await waitFor(() => expect(result.current.isLoading).resolves.toBe(false));
//     expect(result.current.balance).toBeUndefined();
//   });
// });
