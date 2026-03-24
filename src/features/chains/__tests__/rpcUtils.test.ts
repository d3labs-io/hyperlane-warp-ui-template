import { ProviderType } from '@hyperlane-xyz/sdk';
import { BigNumber } from 'ethers';
import { type Chain } from 'viem';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ensureWalletOnChain,
  fibonacciDelays,
  preEstimateGasForEvmTxs,
  raceViemProviderBuilder,
  resilientConfirm,
  waitForChainSwitch,
  withWcRpcFirst,
} from '../rpcUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const llamaUrl = 'https://eth.llamarpc.com';
const ankrUrl = 'https://rpc.ankr.com/eth';

const rpcUrls = [{ http: llamaUrl }, { http: ankrUrl }];

function jsonRpcResponse(result: unknown, id = 1) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeChain(id: number, httpUrls: string[]): Chain {
  return {
    id,
    name: `chain-${id}`,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: httpUrls } },
  } as Chain;
}

// ---------------------------------------------------------------------------
// raceViemProviderBuilder
// ---------------------------------------------------------------------------

describe('raceViemProviderBuilder', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns a typed provider with ProviderType.Viem', () => {
    const result = raceViemProviderBuilder(rpcUrls, 1);
    expect(result.type).toBe(ProviderType.Viem);
    expect(result.provider).toBeDefined();
  });

  test('throws when no RPC URLs are provided', () => {
    expect(() => raceViemProviderBuilder([], 1)).toThrow('No RPC URLs provided');
  });

  test('returns result from second RPC when first fails (CORS/network error)', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if ((url as string).includes('llamarpc')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve(jsonRpcResponse('0x10d4f'));
    });

    const { provider } = raceViemProviderBuilder(rpcUrls, 1);
    const result = await provider.request({ method: 'eth_blockNumber' });
    expect(result).toBe('0x10d4f');
  });

  test('returns result from faster RPC when first RPC is slow', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if ((url as string).includes('llamarpc')) {
        return new Promise(() => {});
      }
      return Promise.resolve(jsonRpcResponse('0xabc'));
    });

    const { provider } = raceViemProviderBuilder(rpcUrls, 1);
    const result = await provider.request({ method: 'eth_blockNumber' });
    expect(result).toBe('0xabc');
  });

  test('returns result from first RPC when both succeed (fastest wins)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRpcResponse('0x1'));

    const { provider } = raceViemProviderBuilder(rpcUrls, 1);
    const result = await provider.request({ method: 'eth_blockNumber' });
    expect(result).toBe('0x1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('throws AggregateError when all RPCs fail', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    const { provider } = raceViemProviderBuilder(rpcUrls, 1);
    await expect(provider.request({ method: 'eth_blockNumber' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// withWcRpcFirst
// ---------------------------------------------------------------------------

describe('withWcRpcFirst', () => {
  const projectId = 'test-project-id';

  test('prepends WalletConnect RPC as first URL for each chain', () => {
    const chains = [
      makeChain(1, ['https://eth.llamarpc.com']),
      makeChain(137, ['https://polygon.rpc.com']),
    ];

    const result = withWcRpcFirst(chains, projectId);

    expect(result[0].rpcUrls.default.http[0]).toBe(
      `https://rpc.walletconnect.org/v1/?chainId=eip155:1&projectId=${projectId}`,
    );
    expect(result[0].rpcUrls.default.http[1]).toBe('https://eth.llamarpc.com');

    expect(result[1].rpcUrls.default.http[0]).toBe(
      `https://rpc.walletconnect.org/v1/?chainId=eip155:137&projectId=${projectId}`,
    );
    expect(result[1].rpcUrls.default.http[1]).toBe('https://polygon.rpc.com');
  });

  test('preserves existing URLs after the WC endpoint', () => {
    const chains = [makeChain(1, ['https://rpc1.com', 'https://rpc2.com'])];
    const result = withWcRpcFirst(chains, projectId);

    expect(result[0].rpcUrls.default.http).toHaveLength(3);
    expect(result[0].rpcUrls.default.http[1]).toBe('https://rpc1.com');
    expect(result[0].rpcUrls.default.http[2]).toBe('https://rpc2.com');
  });

  test('does not mutate the original chains', () => {
    const chains = [makeChain(1, ['https://rpc1.com'])];
    const original = chains[0].rpcUrls.default.http.slice();
    withWcRpcFirst(chains, projectId);
    expect(chains[0].rpcUrls.default.http).toEqual(original);
  });

  test('handles empty chains array', () => {
    expect(withWcRpcFirst([], projectId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// preEstimateGasForEvmTxs
// ---------------------------------------------------------------------------

const mockEstimateGas = vi.fn();
const mockGetPublicClient = vi.fn();
const mockGetAccount = vi.fn();
const mockSwitchChain = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@wagmi/core', () => ({
  getPublicClient: (...args: any[]) => mockGetPublicClient(...args),
  getAccount: (...args: any[]) => mockGetAccount(...args),
  switchChain: (...args: any[]) => mockSwitchChain(...args),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    warn: (...args: any[]) => mockLoggerWarn(...args),
    debug: vi.fn(),
  },
}));

describe('preEstimateGasForEvmTxs', () => {
  const mockConfig = {} as any;

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('sets gasLimit with 20% buffer on transactions without gasLimit', async () => {
    mockEstimateGas.mockResolvedValue(100_000n);
    mockGetPublicClient.mockReturnValue({ estimateGas: mockEstimateGas } as any);

    const txs = [{ transaction: { to: '0xabc', data: '0x1234' } as any }];
    await preEstimateGasForEvmTxs(mockConfig, 1, '0xsender', txs);

    expect(mockEstimateGas).toHaveBeenCalledWith({
      account: '0xsender',
      to: '0xabc',
      data: '0x1234',
      value: undefined,
    });
    expect(txs[0].transaction.gasLimit).toEqual(BigNumber.from('120000'));
  });

  test('skips transactions that already have gasLimit', async () => {
    mockGetPublicClient.mockReturnValue({ estimateGas: mockEstimateGas } as any);

    const txs = [{ transaction: { to: '0xabc', gasLimit: BigNumber.from('50000') } as any }];
    await preEstimateGasForEvmTxs(mockConfig, 1, '0xsender', txs);

    expect(mockEstimateGas).not.toHaveBeenCalled();
  });

  test('converts tx.value to BigInt for estimation', async () => {
    mockEstimateGas.mockResolvedValue(50_000n);
    mockGetPublicClient.mockReturnValue({ estimateGas: mockEstimateGas } as any);

    const txs = [{ transaction: { to: '0xabc', value: BigNumber.from('1000') } as any }];
    await preEstimateGasForEvmTxs(mockConfig, 1, '0xsender', txs);

    expect(mockEstimateGas).toHaveBeenCalledWith(expect.objectContaining({ value: 1000n }));
  });

  test('logs warning and leaves gasLimit unset when estimation fails', async () => {
    const error = new Error('RPC error');
    mockEstimateGas.mockRejectedValue(error);
    mockGetPublicClient.mockReturnValue({ estimateGas: mockEstimateGas } as any);

    const txs = [{ transaction: { to: '0xabc' } as any }];
    await preEstimateGasForEvmTxs(mockConfig, 1, '0xsender', txs);

    expect(txs[0].transaction).not.toHaveProperty('gasLimit');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Gas pre-estimation failed, wallet will estimate during signing',
      error,
    );
  });

  test('skips when getPublicClient returns undefined', async () => {
    mockGetPublicClient.mockReturnValue(undefined as any);

    const txs = [{ transaction: { to: '0xabc' } as any }];
    await preEstimateGasForEvmTxs(mockConfig, 1, '0xsender', txs);

    expect(txs[0].transaction).not.toHaveProperty('gasLimit');
  });

  test('processes multiple transactions independently', async () => {
    mockEstimateGas.mockResolvedValueOnce(100_000n).mockRejectedValueOnce(new Error('fail'));
    mockGetPublicClient.mockReturnValue({ estimateGas: mockEstimateGas } as any);

    const txs = [{ transaction: { to: '0xabc' } as any }, { transaction: { to: '0xdef' } as any }];
    await preEstimateGasForEvmTxs(mockConfig, 1, '0xsender', txs);

    expect(txs[0].transaction.gasLimit).toEqual(BigNumber.from('120000'));
    expect(txs[1].transaction).not.toHaveProperty('gasLimit');
  });
});

// ---------------------------------------------------------------------------
// fibonacciDelays
// ---------------------------------------------------------------------------

describe('fibonacciDelays', () => {
  test('yields Fibonacci sequence in milliseconds', () => {
    const gen = fibonacciDelays();
    const values = Array.from({ length: 8 }, () => gen.next().value);
    expect(values).toEqual([1000, 1000, 2000, 3000, 5000, 8000, 13000, 21000]);
  });

  test('caps delays at maxDelayMs', () => {
    const gen = fibonacciDelays(5000);
    const values = Array.from({ length: 8 }, () => gen.next().value);
    expect(values).toEqual([1000, 1000, 2000, 3000, 5000, 5000, 5000, 5000]);
  });
});

// ---------------------------------------------------------------------------
// waitForChainSwitch
// ---------------------------------------------------------------------------

describe('waitForChainSwitch', () => {
  const mockConfig = {} as any;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('resolves immediately when wallet is already on the correct chain', async () => {
    mockGetAccount.mockReturnValue({ chainId: 1 });

    await expect(waitForChainSwitch(mockConfig, 1)).resolves.toBeUndefined();
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
  });

  test('polls until wallet reports the correct chain', async () => {
    mockGetAccount
      .mockReturnValueOnce({ chainId: 999 }) // first poll: wrong chain
      .mockReturnValue({ chainId: 1 }); // second poll: correct chain

    const p = waitForChainSwitch(mockConfig, 1);
    await vi.advanceTimersByTimeAsync(500); // fire one poll interval
    await expect(p).resolves.toBeUndefined();
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });

  test('resolves after multiple polls', async () => {
    mockGetAccount
      .mockReturnValueOnce({ chainId: 999 })
      .mockReturnValueOnce({ chainId: 999 })
      .mockReturnValue({ chainId: 1 });

    const p = waitForChainSwitch(mockConfig, 1);
    await vi.advanceTimersByTimeAsync(1_000); // two poll intervals
    await expect(p).resolves.toBeUndefined();
    expect(mockGetAccount).toHaveBeenCalledTimes(3);
  });

  test('throws ChainMismatchError after timeout', async () => {
    mockGetAccount.mockReturnValue({ chainId: 999 });

    const p = waitForChainSwitch(mockConfig, 1, 1_000);
    p.catch(() => {}); // prevent unhandled rejection while timers advance
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).rejects.toThrow('ChainMismatchError');
  });

  test('timeout error includes chain id and duration', async () => {
    mockGetAccount.mockReturnValue({ chainId: 999 });

    const p = waitForChainSwitch(mockConfig, 42, 2_000);
    p.catch(() => {}); // prevent unhandled rejection while timers advance
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).rejects.toThrow(/chain 42/);
    await expect(p).rejects.toThrow(/2s/);
  });
});

// ---------------------------------------------------------------------------
// ensureWalletOnChain
// ---------------------------------------------------------------------------

describe('ensureWalletOnChain', () => {
  const mockConfig = {} as any;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('returns immediately without calling switchChain when already on correct chain', async () => {
    mockGetAccount.mockReturnValue({ chainId: 1 });

    await expect(ensureWalletOnChain(mockConfig, 1)).resolves.toBeUndefined();
    expect(mockSwitchChain).not.toHaveBeenCalled();
  });

  test('calls switchChain with the correct arguments when chain does not match', async () => {
    // First getAccount call (initial check) returns wrong chain;
    // second call (inside waitForChainSwitch) returns correct chain.
    mockGetAccount.mockReturnValueOnce({ chainId: 999 }).mockReturnValue({ chainId: 1 });
    mockSwitchChain.mockResolvedValue(undefined);

    await expect(ensureWalletOnChain(mockConfig, 1)).resolves.toBeUndefined();
    expect(mockSwitchChain).toHaveBeenCalledWith(mockConfig, { chainId: 1 });
  });

  test('swallows switchChain rejection and continues polling', async () => {
    mockGetAccount
      .mockReturnValueOnce({ chainId: 999 }) // initial check
      .mockReturnValueOnce({ chainId: 999 }) // waitForChainSwitch first poll
      .mockReturnValue({ chainId: 1 }); // waitForChainSwitch second poll
    mockSwitchChain.mockRejectedValue(new Error('User rejected'));

    const p = ensureWalletOnChain(mockConfig, 1);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeUndefined();
  });

  test('throws ChainMismatchError when chain never switches (timeout)', async () => {
    mockGetAccount.mockReturnValue({ chainId: 999 });
    mockSwitchChain.mockResolvedValue(undefined);

    const p = ensureWalletOnChain(mockConfig, 1);
    p.catch(() => {}); // prevent unhandled rejection while timers advance
    // Advance past the full 30 s default timeout
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(p).rejects.toThrow('ChainMismatchError');
  });

  test('does not call switchChain a second time after initial call fails', async () => {
    mockGetAccount.mockReturnValueOnce({ chainId: 999 }).mockReturnValue({ chainId: 1 });
    mockSwitchChain.mockRejectedValue(new Error('rejected'));

    await ensureWalletOnChain(mockConfig, 1);
    // switchChain should have been called exactly once (not retried internally)
    expect(mockSwitchChain).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// resilientConfirm
// ---------------------------------------------------------------------------

describe('resilientConfirm', () => {
  const mockConfig = {} as any;
  const mockGetTransactionReceipt = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetPublicClient.mockReturnValue({
      getTransactionReceipt: mockGetTransactionReceipt,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('resolves with wallet confirm when it wins the race', async () => {
    const walletReceipt = { type: 'ethersV5', receipt: { hash: '0xabc' } };
    const walletConfirm = vi.fn().mockResolvedValue(walletReceipt);
    // RPC never finds receipt
    mockGetTransactionReceipt.mockRejectedValue(new Error('not found'));

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1);
    // Wallet resolves immediately, before the 5s initial delay even fires
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe(walletReceipt);
  });

  test('resolves with RPC poll when wallet confirm hangs', async () => {
    const rpcReceipt = { status: 'success', transactionHash: '0xhash' };
    // Wallet never resolves
    const walletConfirm = () => new Promise<never>(() => {});
    // RPC succeeds on first poll (after 5s initial delay)
    mockGetTransactionReceipt.mockResolvedValue(rpcReceipt);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1);
    // Fire the 5s initial delay timer synchronously, then let microtasks settle
    vi.advanceTimersByTime(5100);
    const result = await promise;

    expect(result).toEqual({ type: ProviderType.Viem, receipt: rpcReceipt });
  });

  test('rejects when transaction is reverted on-chain', async () => {
    const revertedReceipt = { status: 'reverted', transactionHash: '0xhash' };
    const walletConfirm = () => new Promise<never>(() => {});
    mockGetTransactionReceipt.mockResolvedValue(revertedReceipt);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1);
    // Fire the 5s initial delay timer synchronously, then let microtasks settle
    vi.advanceTimersByTime(5100);

    await expect(promise).rejects.toThrow('Transaction reverted on-chain');
  });

  test('rejects with wallet error when both fail', async () => {
    const walletError = new Error('Wallet rejected');
    const walletConfirm = vi.fn().mockImplementation(() => Promise.reject(walletError));
    mockGetPublicClient.mockReturnValue(null);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1);

    await expect(promise).rejects.toThrow('Wallet rejected');
  });

  test('RPC polling uses Fibonacci backoff after 5s initial delay', async () => {
    const rpcReceipt = { status: 'success', transactionHash: '0xhash' };
    const walletConfirm = () => new Promise<never>(() => {});
    // Fail 3 times, then succeed on 4th call
    mockGetTransactionReceipt
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue(rpcReceipt);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1);

    // 5s initial delay, then first poll fires (fails)
    await vi.advanceTimersByTimeAsync(5100);
    expect(mockGetTransactionReceipt).toHaveBeenCalledTimes(1);

    // Fibonacci delay 1: 1s — second poll (fails)
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockGetTransactionReceipt).toHaveBeenCalledTimes(2);

    // Fibonacci delay 2: 1s — third poll (fails)
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockGetTransactionReceipt).toHaveBeenCalledTimes(3);

    // Fibonacci delay 3: 2s — fourth poll (succeeds)
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(mockGetTransactionReceipt).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ type: ProviderType.Viem, receipt: rpcReceipt });
  });
});
