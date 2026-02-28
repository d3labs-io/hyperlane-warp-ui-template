import { MultiProtocolProvider } from '@hyperlane-xyz/sdk';
import { getWagmiChainConfigs } from '@hyperlane-xyz/widgets';
import { RainbowKitProvider, connectorsForWallets, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import {
  argentWallet,
  binanceWallet,
  coinbaseWallet,
  injectedWallet,
  ledgerWallet,
  metaMaskWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { PropsWithChildren, useMemo } from 'react';
import { type Chain, createClient } from 'viem';
import { WagmiProvider, createConfig } from 'wagmi';
import { APP_NAME } from '../../../consts/app';
import { config } from '../../../consts/config';
import { Color } from '../../../styles/Color';
import { useMultiProvider } from '../../chains/hooks';
import { raceTransport } from '../../chains/rpcUtils';

/**
 * Prepend WalletConnect's own CORS-friendly RPC endpoint as the first URL for
 * each chain. The WalletConnect connector picks `chain.rpcUrls.default.http[0]`
 * for its internal rpcMap — if that URL is CORS-blocked in the browser, any
 * read RPC call (eth_chainId, eth_estimateGas, …) through the WC provider
 * fails. WalletConnect's endpoint is always CORS-safe and available.
 *
 * The raceTransport fires all URLs in parallel, so adding one more has no
 * negative impact on latency.
 */
function withWcRpcFirst(chains: Chain[], projectId: string): Chain[] {
  return chains.map((chain) => {
    const wcRpcUrl = `https://rpc.walletconnect.org/v1/?chainId=eip155:${chain.id}&projectId=${projectId}`;
    return {
      ...chain,
      rpcUrls: {
        ...chain.rpcUrls,
        default: {
          http: [wcRpcUrl, ...chain.rpcUrls.default.http],
        },
      },
    };
  });
}

function initWagmi(multiProvider: MultiProtocolProvider) {
  const rawChains = getWagmiChainConfigs(multiProvider);
  const chains = withWcRpcFirst(rawChains, config.walletConnectProjectId);

  const connectors = connectorsForWallets(
    [
      {
        groupName: 'Recommended',
        wallets: [metaMaskWallet, injectedWallet, walletConnectWallet, ledgerWallet],
      },
      {
        groupName: 'More',
        wallets: [binanceWallet, coinbaseWallet, rainbowWallet, trustWallet, argentWallet],
      },
    ],
    { appName: APP_NAME, projectId: config.walletConnectProjectId },
  );

  const wagmiConfig = createConfig({
    // Splice to make annoying wagmi type happy
    chains: [chains[0], ...chains.splice(1)],
    connectors,
    client({ chain }) {
      return createClient({ chain, transport: raceTransport(chain.rpcUrls.default.http) });
    },
  });

  return { wagmiConfig, chains };
}

export function EvmWalletContext({ children }: PropsWithChildren<unknown>) {
  const multiProvider = useMultiProvider();
  const { wagmiConfig } = useMemo(() => initWagmi(multiProvider), [multiProvider]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider
        theme={lightTheme({
          accentColor: Color.primary['500'],
          borderRadius: 'small',
          fontStack: 'system',
        })}
      >
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
