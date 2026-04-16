import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Card } from '../../components/layout/Card';
import type { AggregatorMode } from './BridgeSwapWidget';

const STORAGE_KEY = 'bridge-swap.aggregator';

// LI.FI widget uses MUI/emotion and browser-only APIs — render client-side only.
const BridgeSwapWidget = dynamic(
  () => import('./BridgeSwapWidget').then((m) => m.BridgeSwapWidget),
  { ssr: false },
);

function readInitialMode(): AggregatorMode {
  if (typeof window === 'undefined') return 'jumper';
  const fromUrl = new URLSearchParams(window.location.search).get('aggregator');
  if (fromUrl === 'jumper' || fromUrl === 'lifi') return fromUrl;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'jumper' || stored === 'lifi') return stored;
  return 'jumper';
}

export function BridgeSwapCard() {
  const [mode, setMode] = useState<AggregatorMode>('jumper');

  useEffect(() => {
    setMode(readInitialMode());
  }, []);

  const updateMode = (next: AggregatorMode) => {
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
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
      <BridgeSwapWidget mode={mode} />
    </Card>
  );
}
