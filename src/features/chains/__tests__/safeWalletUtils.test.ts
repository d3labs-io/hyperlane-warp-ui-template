import { ProviderType } from '@hyperlane-xyz/sdk';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fibonacciDelays, resilientConfirm } from '../safeWalletUtils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPublicClient = vi.fn();
const mockGetTransactionReceipt = vi.fn();
const mockGetBlockNumber = vi.fn();
const mockGetLogs = vi.fn();

vi.mock('@wagmi/core', () => ({
  getPublicClient: (...args: any[]) => mockGetPublicClient(...args),
}));

vi.mock('../../../utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn() },
}));

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
// resilientConfirm (non-Safe path)
// ---------------------------------------------------------------------------

describe('resilientConfirm (no Safe options)', () => {
  const mockConfig = {} as any;

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('resolves with the wallet confirm result', async () => {
    const walletReceipt = { type: 'ethersV5', receipt: { hash: '0xabc', status: 'success' } };
    const walletConfirm = vi.fn().mockResolvedValue(walletReceipt);

    const result = await resilientConfirm(walletConfirm, '0xhash', mockConfig, 1);

    expect(result).toBe(walletReceipt);
  });

  test('rejects when wallet confirm returns a reverted receipt', async () => {
    const revertedReceipt = { type: 'ethersV5', receipt: { hash: '0xabc', status: 'reverted' } };
    const walletConfirm = vi.fn().mockResolvedValue(revertedReceipt);

    await expect(resilientConfirm(walletConfirm, '0xhash', mockConfig, 1)).rejects.toThrow(
      'Transaction reverted on-chain',
    );
  });

  test('rejects with wallet error when confirm throws', async () => {
    const walletError = new Error('Wallet rejected');
    const walletConfirm = vi.fn().mockRejectedValue(walletError);

    await expect(resilientConfirm(walletConfirm, '0xhash', mockConfig, 1)).rejects.toThrow(
      'Wallet rejected',
    );
  });
});

// ---------------------------------------------------------------------------
// resilientConfirm with event-based polling (Safe wallet support)
// ---------------------------------------------------------------------------

describe('resilientConfirm with event polling (Safe wallet)', () => {
  const mockConfig = {} as any;

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

  test('rejects with wallet error when both legs fail', async () => {
    const walletError = new Error('Wallet rejected by user');
    const walletConfirm = vi.fn().mockImplementation(() => Promise.reject(walletError));

    // No public client → event polling fails immediately
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

  test('wallet confirm wins when it resolves before event polling fires', async () => {
    const walletReceipt = {
      type: 'ethersV5',
      receipt: { transactionHash: '0xhash', status: 'success' },
    };
    const walletConfirm = vi.fn().mockResolvedValue(walletReceipt);
    mockGetLogs.mockResolvedValue([]);

    const promise = resilientConfirm(walletConfirm, '0xhash', mockConfig, 1, {
      contractAddress: '0xContract',
      sender: '0xSender1234567890abcdef1234567890abcdef1234',
    });

    // Wallet resolves immediately before the 15s event poll initial delay fires
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe(walletReceipt);
    // getLogs should not have been called since event polling hasn't started
    expect(mockGetLogs).not.toHaveBeenCalled();
  });
});
