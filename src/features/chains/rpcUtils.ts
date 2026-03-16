/**
 * RPC resilience utilities.
 *
 * Problem: viem's default `fallback` transport tries RPC endpoints sequentially
 * and cannot recover from browser CORS errors (`TypeError: Failed to fetch`).
 * WalletConnect's internal provider picks a single RPC from the chain config for
 * its rpcMap, which may also be CORS-blocked.
 *
 * Solution: race ALL endpoints in parallel so CORS-blocked or slow ones lose the
 * race silently, and prepend WalletConnect's own CORS-safe RPC so the WC
 * connector always has a working endpoint.
 */

import {
  ChainMetadata,
  ProviderType,
  TypedTransactionReceipt,
  ViemProvider,
} from '@hyperlane-xyz/sdk';
import { getPublicClient } from '@wagmi/core';
import { BigNumber } from 'ethers';
import { type Chain, createPublicClient, custom } from 'viem';
import { type Config as WagmiConfig } from 'wagmi';
import { logger } from '../../utils/logger';

let reqId = 0;

// ---------------------------------------------------------------------------
// Core transport
// ---------------------------------------------------------------------------

/**
 * A viem custom transport that fires every JSON-RPC request to **all** provided
 * HTTP endpoints simultaneously and resolves with the first successful response.
 */
export function raceTransport(httpUrls: readonly string[]) {
  return custom({
    async request({ method, params }) {
      if (!httpUrls.length) throw new Error('No RPC URLs provided');
      const id = ++reqId;
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      return Promise.any(
        [...httpUrls].map((url) =>
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
            .then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
              return r.json();
            })
            .then((r) => {
              if (r.error) throw r.error;
              return r.result;
            }),
        ),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// SDK provider builder
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for the SDK's default Viem provider builder.
 * Uses {@link raceTransport} so every SDK-level RPC call is CORS-resilient.
 */
export function raceViemProviderBuilder(
  rpcUrls: ChainMetadata['rpcUrls'],
  network: number | string,
): ViemProvider {
  if (!rpcUrls.length) throw new Error('No RPC URLs provided');

  const id = parseInt(network.toString(), 10);
  const name = network.toString();

  const client = createPublicClient({
    chain: {
      id,
      name,
      nativeCurrency: { name: '', symbol: '', decimals: 0 },
      rpcUrls: {
        default: { http: rpcUrls.map((r) => r.http) },
        public: { http: rpcUrls.map((r) => r.http) },
      },
    },
    transport: raceTransport(rpcUrls.map((r) => r.http)),
  });

  return { type: ProviderType.Viem, provider: client as ViemProvider['provider'] };
}

// ---------------------------------------------------------------------------
// WalletConnect rpcMap fix
// ---------------------------------------------------------------------------

/**
 * Prepend WalletConnect's own CORS-safe RPC as the first URL for each chain.
 *
 * The WC connector builds its internal rpcMap from `chain.rpcUrls.default.http[0]`.
 * If that URL is CORS-blocked, every read through the WC provider (eth_chainId,
 * eth_estimateGas, …) fails. Prepending the WC endpoint guarantees a working
 * first URL while the raceTransport still fires all endpoints in parallel.
 */
export function withWcRpcFirst(chains: Chain[], projectId: string): Chain[] {
  return chains.map((chain) => {
    const wcRpcUrl = `https://rpc.walletconnect.org/v1/?chainId=eip155:${chain.id}&projectId=${projectId}`;
    return {
      ...chain,
      rpcUrls: {
        ...chain.rpcUrls,
        default: { http: [wcRpcUrl, ...chain.rpcUrls.default.http] },
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Gas pre-estimation
// ---------------------------------------------------------------------------

const GAS_BUFFER_PERCENT = 120n; // 20% safety margin

/**
 * Pre-estimate gas for EVM transactions using the public client (raceTransport).
 *
 * wagmi's `sendTransaction` estimates gas through the connector client. For
 * WalletConnect that routes through the rpcMap, which may be CORS-blocked.
 * By setting `gasLimit` before the tx reaches wagmi, its internal estimation is
 * skipped entirely. On failure the wallet estimates gas during signing instead.
 */
export async function preEstimateGasForEvmTxs(
  wagmiConfig: WagmiConfig,
  chainId: number,
  sender: string,
  txs: { transaction: Record<string, any> }[],
): Promise<void> {
  for (const tx of txs) {
    const ethTx = tx.transaction;
    if (ethTx.gasLimit) continue; // already set by the SDK
    try {
      const publicClient = getPublicClient(wagmiConfig, { chainId });
      if (!publicClient) continue;
      const gas = await publicClient.estimateGas({
        account: sender as `0x${string}`,
        to: ethTx.to as `0x${string}`,
        data: ethTx.data as `0x${string}` | undefined,
        value: ethTx.value ? BigInt(ethTx.value.toString()) : undefined,
      });
      ethTx.gasLimit = BigNumber.from(((gas * GAS_BUFFER_PERCENT) / 100n).toString());
    } catch (e) {
      logger.warn('Gas pre-estimation failed, wallet will estimate during signing', e);
    }
  }
}

// ---------------------------------------------------------------------------
// Resilient transaction confirmation
// ---------------------------------------------------------------------------

const INITIAL_POLL_DELAY_MS = 5_000; // wait before first poll
const MAX_POLL_DURATION_MS = 60 * 60 * 1_000; // 1 hour
const MAX_FIBONACCI_DELAY_MS = 30_000; // cap individual interval at 30s
const TX_REVERTED_ERROR = 'Transaction reverted on-chain';

/**
 * Fibonacci delay generator for polling intervals (in milliseconds).
 * Yields: 1000, 1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000, 30000, …
 */
export function* fibonacciDelays(maxDelayMs = MAX_FIBONACCI_DELAY_MS): Generator<number> {
  let a = 1_000;
  let b = 1_000;
  while (true) {
    yield Math.min(a, maxDelayMs);
    [a, b] = [b, a + b];
  }
}

/**
 * Poll the blockchain directly for a transaction receipt using Fibonacci backoff.
 * Uses the wagmi public client which already races across all configured RPCs
 * via {@link raceTransport}.
 */
async function pollForReceipt(
  txHash: string,
  wagmiConfig: WagmiConfig,
  chainId: number,
  signal: AbortSignal,
): Promise<TypedTransactionReceipt> {
  const publicClient = getPublicClient(wagmiConfig, { chainId });
  if (!publicClient) throw new Error('No public client available for RPC polling');

  const startTime = Date.now();
  const delays = fibonacciDelays();

  // Wait before first poll to give the wallet a chance to confirm on its own
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, INITIAL_POLL_DELAY_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Polling cancelled'));
      },
      { once: true },
    );
  });

  while (!signal.aborted) {
    if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
      throw new Error('RPC polling timed out');
    }

    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (receipt.status === 'reverted') {
        throw new Error(TX_REVERTED_ERROR);
      }

      logger.debug('RPC polling confirmed tx:', txHash);
      return { type: ProviderType.Viem, receipt } as TypedTransactionReceipt;
    } catch (error: any) {
      // Propagate revert — the tx genuinely failed
      if (error?.message === TX_REVERTED_ERROR) throw error;
      // Otherwise tx isn't mined yet or RPC hiccup — wait and retry
    }

    const delay = delays.next().value!;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Polling cancelled'));
        },
        { once: true },
      );
    });
  }

  throw new Error('Polling cancelled');
}

/**
 * Race the wallet's confirm() against direct RPC polling.
 *
 * WalletConnect behaviour varies across wallet brands — some wallets fail to
 * resolve the confirmation callback even after the tx lands on-chain. This
 * function polls the blockchain directly (with Fibonacci backoff across all
 * configured RPCs) in parallel with the wallet's own confirm(). Whichever
 * returns first wins.
 *
 * Semantics (differs from Promise.any):
 * - Either fulfills → resolve immediately, abort the other.
 * - RPC rejects with "reverted" → reject immediately (definitive on-chain failure).
 * - Wallet rejects but RPC still running → keep polling (wallet errors are not definitive).
 * - Both reject → surface the wallet error (more informative for the user).
 */
export async function resilientConfirm(
  walletConfirm: () => Promise<TypedTransactionReceipt>,
  txHash: string,
  wagmiConfig: WagmiConfig,
  chainId: number,
): Promise<TypedTransactionReceipt> {
  const controller = new AbortController();
  const cleanup = () => controller.abort();

  let walletDone = false;
  let rpcDone = false;
  let walletError: Error | undefined;

  // Signals when both legs have failed so Promise.race can reject
  let signalBothFailed!: () => void;
  const bothFailedBarrier = new Promise<void>((r) => {
    signalBothFailed = r;
  });

  // Wallet leg: on success → resolve; on failure → swallow (keep RPC alive)
  const walletLeg = walletConfirm().catch((err) => {
    walletDone = true;
    walletError = err;
    if (rpcDone) signalBothFailed();
    return new Promise<TypedTransactionReceipt>(() => {}); // hang until RPC settles
  });

  // RPC leg: on success → resolve; on revert → throw; on other failure → swallow
  const rpcLeg = pollForReceipt(txHash, wagmiConfig, chainId, controller.signal).catch((err) => {
    if (err?.message === TX_REVERTED_ERROR) throw err; // definitive on-chain failure
    rpcDone = true;
    if (walletDone) signalBothFailed();
    return new Promise<TypedTransactionReceipt>(() => {}); // hang until wallet settles
  });

  // Both-failed leg: rejects with wallet error when both legs have failed
  const bothFailedLeg = bothFailedBarrier.then((): never => {
    throw walletError ?? new Error('Both wallet and RPC polling failed');
  });

  // Prevent unhandled rejection if one leg wins and the other later rejects
  rpcLeg.catch(() => {});
  bothFailedLeg.catch(() => {});

  try {
    const result = await Promise.race([walletLeg, rpcLeg, bothFailedLeg]);
    cleanup();
    return result;
  } catch (err) {
    cleanup();
    throw err;
  }
}
