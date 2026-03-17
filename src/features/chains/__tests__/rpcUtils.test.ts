import { ProviderType } from '@hyperlane-xyz/sdk';
import { BigNumber } from 'ethers';
import { type Chain } from 'viem';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fibonacciDelays,
  preEstimateGasForEvmTxs,
  raceViemProviderBuilder,
  resilientConfirm,
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
const mockLoggerWarn = vi.fn();

vi.mock('@wagmi/core', () => ({
  getPublicClient: (...args: any[]) => mockGetPublicClient(...args),
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

// ---------------------------------------------------------------------------
// resilientConfirm with event-based polling (Safe wallet support)
// ---------------------------------------------------------------------------

describe('resilientConfirm with event polling (Safe wallet)', () => {
  const mockConfig = {} as any;
  const mockGetTransactionReceipt = vi.fn();
  const mockGetBlockNumber = vi.fn();
  const mockGetLogs = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetPublicClient.mockReturnValue({
      getTransactionReceipt: mockGetTransactionReceipt,
      getBlockNumber: mockGetBlockNumber,
      getLogs: mockGetLogs,
    } as any);
    mockGetBlockNumber.mockResolvedValue(100n);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('event polling detects tx when hash-based polling fails (Safe wallet)', async () => {
    const realTxHash = '0xreal_onchain_hash';
    const onChainReceipt = { status: 'success', transactionHash: realTxHash };
    const safeTxHash = '0xsafe_internal_hash';
    const sender = '0xSafeAddress1234567890abcdef1234567890abcdef';
    const contractAddress = '0xContractAddr';
    const paddedSender = '0x' + sender.slice(2).toLowerCase().padStart(64, '0');

    // Wallet never resolves (safeTxHash can't be confirmed via standard flow)
    const walletConfirm = () => new Promise<never>(() => {});

    // Hash-based polling always fails (safeTxHash not on-chain)
    mockGetTransactionReceipt.mockImplementation(({ hash }: { hash: string }) => {
      if (hash === safeTxHash) return Promise.reject(new Error('not found'));
      if (hash === realTxHash) return Promise.resolve(onChainReceipt);
      return Promise.reject(new Error('not found'));
    });

    // Event polling: no logs initially, then matching logs appear
    mockGetLogs
      .mockResolvedValueOnce([]) // first poll: no events yet
      .mockResolvedValue([
        {
          transactionHash: realTxHash,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer topic0
            paddedSender, // from = Safe address
          ],
        },
      ]);

    const promise = resilientConfirm(walletConfirm, safeTxHash, mockConfig, 1, {
      contractAddress,
      sender,
    });

    // Advance past 15s event poll initial delay (block number captured before sleep)
    await vi.advanceTimersByTimeAsync(15100);
    // First getLogs call returns empty, wait fibonacci delay (1s)
    await vi.advanceTimersByTimeAsync(1100);
    // Second getLogs call returns matching log → receipt fetched → resolved

    const result = await promise;
    expect(result).toEqual({ type: ProviderType.Viem, receipt: onChainReceipt });
    // startBlock = 100n - 10n = 90n (10-block safety buffer)
    expect(mockGetLogs).toHaveBeenCalledWith({
      address: contractAddress,
      fromBlock: 90n,
      toBlock: 'latest',
    });
  });

  test('event polling rejects on reverted tx', async () => {
    const realTxHash = '0xreverted_hash';
    const sender = '0xSafeAddress1234567890abcdef1234567890abcdef';
    const paddedSender = '0x' + sender.slice(2).toLowerCase().padStart(64, '0');

    const walletConfirm = () => new Promise<never>(() => {});
    mockGetTransactionReceipt.mockImplementation(({ hash }: { hash: string }) => {
      if (hash === '0xsafe_hash') return Promise.reject(new Error('not found'));
      return Promise.resolve({ status: 'reverted', transactionHash: realTxHash });
    });

    mockGetLogs.mockResolvedValue([
      {
        transactionHash: realTxHash,
        topics: ['0xtopic0', paddedSender],
      },
    ]);

    const promise = resilientConfirm(walletConfirm, '0xsafe_hash', mockConfig, 1, {
      contractAddress: '0xContract',
      sender,
    });

    // Flush microtasks so getBlockNumber() resolves (called before sleep now),
    // then advance timers synchronously to avoid unhandled rejection warnings
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(15200);

    await expect(promise).rejects.toThrow('Transaction reverted on-chain');
  });

  test('rejects with wallet error when all three legs fail', async () => {
    const walletError = new Error('Wallet rejected by user');
    const walletConfirm = vi.fn().mockImplementation(() => Promise.reject(walletError));

    // No public client → both RPC and event polling fail immediately
    mockGetPublicClient.mockReturnValue(null);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1, {
      contractAddress: '0xContract',
      sender: '0xSender1234567890abcdef1234567890abcdef1234',
    });

    await expect(promise).rejects.toThrow('Wallet rejected by user');
  });

  test('detects transferRemote via Safe ExecutionSuccess when target contract has no sender-indexed events', async () => {
    const realTxHash = '0xreal_onchain_hash';
    const onChainReceipt = { status: 'success', transactionHash: realTxHash };
    const safeTxHash = '0xsafe_internal_hash';
    const sender = '0xSafeAddress1234567890abcdef1234567890abcdef';
    const contractAddress = '0xRouterContract';

    const walletConfirm = () => new Promise<never>(() => {});

    // Hash-based polling always fails (safeTxHash not on-chain)
    mockGetTransactionReceipt.mockImplementation(({ hash }: { hash: string }) => {
      if (hash === realTxHash) return Promise.resolve(onChainReceipt);
      return Promise.reject(new Error('not found'));
    });

    // Router emits SentTransferRemote(destination, recipient, amount) — sender NOT indexed
    // Safe contract emits ExecutionSuccess(bytes32 indexed txHash, uint256 payment)
    mockGetLogs.mockImplementation(({ address }: { address: string }) => {
      if (address === contractAddress) return Promise.resolve([]); // no sender topic
      if (address === sender)
        return Promise.resolve([
          {
            transactionHash: realTxHash,
            topics: [
              '0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e', // ExecutionSuccess selector
              safeTxHash, // indexed txHash = safeTxHash we received from sendTransaction
            ],
          },
        ]);
      return Promise.resolve([]);
    });

    const promise = resilientConfirm(walletConfirm, safeTxHash, mockConfig, 1, {
      contractAddress,
      sender,
    });

    // After 15s initial delay the first cycle matches via senderLogs immediately
    await vi.advanceTimersByTimeAsync(15100);
    const result = await promise;

    expect(result).toEqual({ type: ProviderType.Viem, receipt: onChainReceipt });
    expect(mockGetLogs).toHaveBeenCalledWith(
      expect.objectContaining({ address: sender, fromBlock: 90n }),
    );
  });

  test('detects tx via Safe ExecutionSuccess when txHash is non-indexed (in data, not topics)', async () => {
    // Kairos Safe: ExecutionSuccess(bytes32 txHash, uint256 payment) — txHash NOT indexed
    const realTxHash = '0xreal_onchain_hash_kairos';
    const onChainReceipt = { status: 'success', transactionHash: realTxHash };
    const safeTxHash = '0xfebace30d802464d9ff84fc97c5d40f950521ce8aee1602fdf91cb41b576e055';
    const sender = '0x1e4bbdef691b9fa30b9365948ccd04fd66d3e5f0';
    const contractAddress = '0x8fe41adb2890df3d591160052fb0e502e4f07f11'; // warp router

    const walletConfirm = () => new Promise<never>(() => {});
    mockGetTransactionReceipt.mockImplementation(({ hash }: { hash: string }) => {
      if (hash === realTxHash) return Promise.resolve(onChainReceipt);
      return Promise.reject(new Error('not found'));
    });

    mockGetLogs.mockImplementation(({ address }: { address: string }) => {
      if (address === contractAddress) return Promise.resolve([]); // no sender-indexed events
      if (address === sender)
        return Promise.resolve([
          {
            transactionHash: realTxHash,
            // Only the event selector in topics — txHash is non-indexed, in data instead
            topics: ['0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e'],
            data: safeTxHash + '0000000000000000000000000000000000000000000000000000000000000000',
          },
        ]);
      return Promise.resolve([]);
    });

    const promise = resilientConfirm(walletConfirm, safeTxHash, mockConfig, 1, {
      contractAddress,
      sender,
    });

    await vi.advanceTimersByTimeAsync(15100);
    const result = await promise;

    expect(result).toEqual({ type: ProviderType.Viem, receipt: onChainReceipt });
  });

  test('hash-based polling still wins if it resolves before event polling', async () => {
    const receipt = { status: 'success', transactionHash: '0xhash' };
    const walletConfirm = () => new Promise<never>(() => {});
    // Hash-based polling succeeds (normal wallet, not Safe)
    mockGetTransactionReceipt.mockResolvedValue(receipt);
    mockGetLogs.mockResolvedValue([]);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1, {
      contractAddress: '0xContract',
      sender: '0xSender1234567890abcdef1234567890abcdef1234',
    });

    // Hash-based polling resolves at 5s (before event polling starts at 15s)
    vi.advanceTimersByTime(5100);
    const result = await promise;

    expect(result).toEqual({ type: ProviderType.Viem, receipt });
    // getLogs should not have been called since event polling hasn't started
    expect(mockGetLogs).not.toHaveBeenCalled();
  });
});
