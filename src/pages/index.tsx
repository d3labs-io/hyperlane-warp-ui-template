import type { NextPage } from 'next';
import { useState } from 'react';
import { FloatingButtonStrip } from '../components/nav/FloatingButtonStrip';
import { TipCard } from '../components/tip/TipCard';
import { BridgeSwapCard } from '../features/bridgeSwap/BridgeSwapCard';
import { TransferTokenCard } from '../features/transfer/TransferTokenCard';

type Tab = 'transfer' | 'bridgeSwap';

const TABS: { id: Tab; label: string }[] = [
  { id: 'transfer', label: 'Pruv Bridge' },
  { id: 'bridgeSwap', label: 'Other Bridge' },
];

const Home: NextPage = () => {
  const [tab, setTab] = useState<Tab>('transfer');

  return (
    <div className="space-y-3 pt-4">
      <TipCard />
      <div className="flex justify-center">
        <div className="flex rounded-full bg-white p-1 shadow-sm">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        {tab === 'transfer' ? <TransferTokenCard /> : <BridgeSwapCard />}
        {tab === 'transfer' && <FloatingButtonStrip />}
      </div>
    </div>
  );
};

export default Home;
