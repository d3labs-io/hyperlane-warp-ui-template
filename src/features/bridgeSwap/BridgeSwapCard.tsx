import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { SolidButton } from '../../components/buttons/SolidButton';
import { ErrorBoundary } from '../../components/errors/ErrorBoundary';
import { Card } from '../../components/layout/Card';
import type { AggregatorMode } from './BridgeSwapWidget';

const MODE_STORAGE_KEY = 'bridge-swap.aggregator';
const DISCLAIMER_STORAGE_KEY = 'bridge-swap.disclaimer-accepted';

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
    const value = window.localStorage.getItem(MODE_STORAGE_KEY);
    return isAggregatorMode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: AggregatorMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
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

function readAcceptedDisclaimer(): boolean {
  try {
    return window.localStorage.getItem(DISCLAIMER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAcceptedDisclaimer() {
  try {
    window.localStorage.setItem(DISCLAIMER_STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

export function BridgeSwapCard() {
  const [mode, setMode] = useState<AggregatorMode>('jumper');
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setMode(readInitialMode());
    setAccepted(readAcceptedDisclaimer());
  }, []);

  const updateMode = (next: AggregatorMode) => {
    setMode(next);
    writeStoredMode(next);
  };

  const acceptDisclaimer = () => {
    writeAcceptedDisclaimer();
    setAccepted(true);
  };

  return (
    <Card className="w-100 sm:w-[31rem]">
      {accepted ? (
        <>
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
        </>
      ) : (
        <DisclaimerGate
          checked={checked}
          onToggle={setChecked}
          onAccept={acceptDisclaimer}
        />
      )}
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

function DisclaimerGate({
  checked,
  onToggle,
  onAccept,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  onAccept: () => void;
}) {
  return (
    <div className="space-y-4 px-1 py-2 text-sm text-gray-700">
      <h3 className="text-base font-semibold text-gray-900">Third-party service notice</h3>
      <p className="leading-relaxed">
        This bridge and swap feature is powered by{' '}
        <a
          href="https://li.fi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-900"
        >
          LI.FI
        </a>
        , a third-party service operated independently of Pruv. Pruv does not control, audit, or
        guarantee the availability, pricing, or security of LI.FI or its partner bridges and DEXs.
      </p>
      <p className="leading-relaxed">
        By continuing you acknowledge that Pruv is not liable for any failed transactions, loss of
        funds, slippage, MEV, smart-contract failure, or other damages arising from use of this
        feature, and you agree to LI.FI&apos;s{' '}
        <a
          href="https://li.fi/legal/terms-and-conditions/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-900"
        >
          terms of service
        </a>
        .
      </p>
      <label className="flex cursor-pointer items-start gap-2 select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer"
        />
        <span>I have read and accept the above terms.</span>
      </label>
      <SolidButton
        type="button"
        onClick={onAccept}
        disabled={!checked}
        bold
        className="w-full px-4 py-2 text-sm"
      >
        Continue
      </SolidButton>
    </div>
  );
}
