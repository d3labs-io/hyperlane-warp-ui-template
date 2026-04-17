import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Card } from '../../components/layout/Card';
import { ErrorBoundary } from '../../components/errors/ErrorBoundary';
import type { AggregatorMode } from './BridgeSwapWidget';

const STORAGE_KEY = 'bridge-swap.aggregator';

// LI.FI widget uses MUI/emotion and browser-only APIs — render client-side only.
const BridgeSwapWidget = dynamic(
  () => import('./BridgeSwapWidget').then((m) => m.BridgeSwapWidget),
  { ssr: false },
);

function isAggregatorMode(value: unknown): value is AggregatorMode {
  return value === 'jumper' || value === 'lifi';
}

function readStoredMode(): AggregatorMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isAggregatorMode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: AggregatorMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Safari private mode, disabled storage, quota exceeded — ignore.
  }
}

function readInitialMode(): AggregatorMode {
  if (typeof window === 'undefined') return 'jumper';
  const fromUrl = new URLSearchParams(window.location.search).get('aggregator');
  if (isAggregatorMode(fromUrl)) return fromUrl;
  return readStoredMode() ?? 'jumper';
}

export function BridgeSwapCard() {
  const [mode, setMode] = useState<AggregatorMode>('jumper');

  useEffect(() => {
    setMode(readInitialMode());
  }, []);

  const updateMode = (next: AggregatorMode) => {
    setMode(next);
    writeStoredMode(next);
  };

  return (
    <Card className="w-100 sm:w-[31rem]">
      <div className="mb-3 flex items-center justify-between gap-2 px-1 text-sm">
        <label htmlFor="aggregator" className="font-medium text-gray-700">
          Aggregator
        </label>
        <select
          id="aggregator"
          value={mode}
          onChange={(e) => updateMode(e.target.value as AggregatorMode)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        >
          <option value="jumper">Jumper (0% fee)</option>
          <option value="lifi">LI.FI direct (0.25% fee)</option>
        </select>
      </div>
      <ErrorBoundary>
        <BridgeSwapWidget mode={mode} />
      </ErrorBoundary>
      <p className="mt-3 px-1 text-xxs leading-snug text-gray-500">
        Bridging and swapping is powered by{' '}
        <a
          href="https://li.fi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          LI.FI
        </a>
        , a third-party service. Pruv does not operate this service and is not liable for any
        failed transactions, loss of funds, slippage, or other damages arising from its use. By
        using this feature you agree to LI.FI&apos;s{' '}
        <a
          href="https://li.fi/legal/terms-and-conditions/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          terms of service
        </a>
        .
      </p>
    </Card>
  );
}
