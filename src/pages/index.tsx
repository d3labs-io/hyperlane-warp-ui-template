import type { NextPage } from 'next';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FloatingButtonStrip } from '../components/nav/FloatingButtonStrip';
import { TipCard } from '../components/tip/TipCard';
import { BridgeSwapCard } from '../features/bridgeSwap/BridgeSwapCard';
import { TransferTokenCard } from '../features/transfer/TransferTokenCard';
import { getQueryParams, updateQueryParam } from '../utils/queryParams';

type Tab = 'transfer' | 'bridgeSwap';

const TABS: { id: Tab; label: string }[] = [
  { id: 'transfer', label: 'Pruv Bridge' },
  { id: 'bridgeSwap', label: 'Other Bridge' },
];

const TAB_QUERY_KEY = 'tab';
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

function isTab(value: unknown): value is Tab {
  return typeof value === 'string' && TAB_IDS.has(value);
}

function readInitialTab(): Tab {
  if (typeof window === 'undefined') return 'transfer';
  const fromUrl = getQueryParams().get(TAB_QUERY_KEY);
  return isTab(fromUrl) ? fromUrl : 'transfer';
}

const Home: NextPage = () => {
  const [tab, setTab] = useState<Tab>('transfer');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    setTab(readInitialTab());
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    updateQueryParam(TAB_QUERY_KEY, next);
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    let target: number | null = null;
    if (e.key === 'ArrowRight') target = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') target = index === 0 ? last : index - 1;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = last;
    if (target === null) return;
    e.preventDefault();
    const nextTab = TABS[target].id;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <div className="space-y-3 pt-4">
      <TipCard />
      <div className="flex justify-center">
        <div role="tablist" aria-label="Bridge mode" className="flex rounded-full bg-white p-1 shadow-sm">
          {TABS.map(({ id, label }, index) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={selected}
                aria-controls={`tabpanel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  selected ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="relative"
      >
        {tab === 'transfer' ? <TransferTokenCard /> : <BridgeSwapCard />}
        {tab === 'transfer' && <FloatingButtonStrip />}
      </div>
    </div>
  );
};

export default Home;
