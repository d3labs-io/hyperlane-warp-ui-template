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

function buildConfig(mode: AggregatorMode): WidgetConfig {
  if (mode === 'jumper') {
    return {
      integrator: 'jumper.exchange',
      sdkConfig: {
        apiUrl: JUMPER_PROXY_URL,
        requestInterceptor: jumperRequestInterceptor,
      },
    };
  }
  return { integrator: LIFI_INTEGRATOR };
}

export function BridgeSwapWidget({ mode }: { mode: AggregatorMode }) {
  const config = useMemo(() => buildConfig(mode), [mode]);
  // key forces a fresh widget mount when the aggregator changes, so the SDK
  // re-initializes against the new apiUrl / interceptor.
  return <LiFiWidget key={mode} {...config} />;
}
