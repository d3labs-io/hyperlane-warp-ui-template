import { LiFiWidget, type WidgetConfig } from '@lifi/widget';
import { useMemo } from 'react';

export type AggregatorMode = 'jumper' | 'lifi';

const JUMPER_PROXY_URL = process.env.NEXT_PUBLIC_JUMPER_API_URL ?? '/api/jumper';
const LIFI_INTEGRATOR = process.env.NEXT_PUBLIC_LIFI_INTEGRATOR ?? 'bridge-swap-widget';

const jumperRequestInterceptor = async (req: RequestInit) => {
  // Browser strips Origin/Referer/User-Agent (forbidden headers) — the Next.js
  // API proxy rewrites those. Here we just tag the aggregator identity.
  const headers = new Headers(req.headers as HeadersInit | undefined);
  headers.set('x-lifi-integrator', 'jumper.exchange');
  headers.set('x-lifi-widget', '4.0.0-beta.14');
  req.headers = headers;
  return req;
};

// The host app mounts its own WagmiProvider with a Hyperlane-derived chain list.
// Without this flag the widget would piggyback on that context and fail
// `switchChain` with "Chain not configured" for any route outside the host's
// chains. Forcing internal management makes the widget self-contained with the
// full LI.FI chain catalog; users connect a wallet inside the widget itself.
const walletConfig = { forceInternalWalletManagement: true };

function buildConfig(mode: AggregatorMode): WidgetConfig {
  if (mode === 'jumper') {
    return {
      integrator: 'jumper.exchange',
      walletConfig,
      sdkConfig: {
        apiUrl: JUMPER_PROXY_URL,
        requestInterceptor: jumperRequestInterceptor,
      },
    };
  }
  return { integrator: LIFI_INTEGRATOR, walletConfig };
}

export function BridgeSwapWidget({ mode }: { mode: AggregatorMode }) {
  const config = useMemo(() => buildConfig(mode), [mode]);
  // key forces a fresh widget mount when the aggregator changes, so the SDK
  // re-initializes against the new apiUrl / interceptor.
  return <LiFiWidget key={mode} {...config} />;
}
