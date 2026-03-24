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

import { ChainMetadata, ProviderType, ViemProvider } from '@hyperlane-xyz/sdk';
import { getAccount, getPublicClient, switchChain } from '@wagmi/core';
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

  return { type: ProviderType.Viem, provider: client as unknown as ViemProvider['provider'] };
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
// WalletConnect chain-switch resilience
// ---------------------------------------------------------------------------

const CHAIN_SWITCH_POLL_MS = 500;
const CHAIN_SWITCH_TIMEOUT_MS = 30_000;

/**
 * Poll wagmi's getAccount until the active chain matches `chainId`.
 *
 * WalletConnect with MetaMask mobile can take several seconds after switchChain
 * resolves before the wagmi store reflects the new chain. Polling here avoids
 * the hard-coded 2 s sleep in @hyperlane-xyz/widgets which is often too short.
 */
export async function waitForChainSwitch(
  wagmiConfig: WagmiConfig,
  chainId: number,
  timeoutMs = CHAIN_SWITCH_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getAccount(wagmiConfig).chainId === chainId) return;
    await new Promise<void>((r) => setTimeout(r, CHAIN_SWITCH_POLL_MS));
  }
  throw new Error(
    `ChainMismatchError: wallet did not switch to chain ${chainId} within ${timeoutMs / 1000}s`,
  );
}

/**
 * Switch the wallet to `chainId` (if not already there) and wait for wagmi to
 * reflect the change before returning. Safe to call before every EVM transaction.
 */
export async function ensureWalletOnChain(
  wagmiConfig: WagmiConfig,
  chainId: number,
): Promise<void> {
  if (getAccount(wagmiConfig).chainId === chainId) return;
  try {
    await switchChain(wagmiConfig, { chainId });
  } catch {
    // Ignore — wallet may reject if already on the right chain or user cancels.
    // waitForChainSwitch below will throw with a clear message if it still fails.
  }
  await waitForChainSwitch(wagmiConfig, chainId);
}
