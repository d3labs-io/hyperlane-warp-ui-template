import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Widget = ({ mode }: { mode: string }) => <div data-testid="widget">{mode}</div>;
    Widget.displayName = 'BridgeSwapWidgetMock';
    return Widget;
  },
}));

vi.mock('@hyperlane-xyz/widgets', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BridgeSwapCard } from '../BridgeSwapCard';

const STORAGE_KEY = 'bridge-swap.aggregator';

function setLocation(search: string) {
  const url = new URL(`http://localhost/${search}`);
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

// jsdom in this repo doesn't expose a full Storage — patch in a Map-backed one per test.
function installFakeStorage() {
  const store = new Map<string, string>();
  const impl = {
    getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, String(v));
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { value: impl, configurable: true });
  return impl;
}

describe('BridgeSwapCard', () => {
  let storage: ReturnType<typeof installFakeStorage>;

  beforeEach(() => {
    setLocation('');
    storage = installFakeStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to jumper when no URL param or stored value', async () => {
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));
    expect(screen.getByRole('combobox')).toHaveValue('jumper');
  });

  it('reads the aggregator from the URL ?aggregator= param', async () => {
    setLocation('?aggregator=lifi');
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('lifi'));
  });

  it('falls back to localStorage when URL param is absent', async () => {
    storage.setItem(STORAGE_KEY, 'lifi');
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('lifi'));
  });

  it('prefers URL param over localStorage', async () => {
    storage.setItem(STORAGE_KEY, 'lifi');
    setLocation('?aggregator=jumper');
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));
  });

  it('ignores garbage values in both the URL and storage', async () => {
    storage.setItem(STORAGE_KEY, 'banana');
    setLocation('?aggregator=not-a-real-mode');
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));
  });

  it('writes the new mode to localStorage on change', async () => {
    const user = userEvent.setup();
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));

    await user.selectOptions(screen.getByRole('combobox'), 'lifi');

    expect(screen.getByTestId('widget')).toHaveTextContent('lifi');
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'lifi');
  });

  it('does not throw if localStorage.getItem fails (e.g. Safari private mode)', async () => {
    storage.getItem.mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => render(<BridgeSwapCard />)).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));
  });

  it('does not throw if localStorage.setItem fails on change', async () => {
    const user = userEvent.setup();
    render(<BridgeSwapCard />);
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));

    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    await expect(user.selectOptions(screen.getByRole('combobox'), 'lifi')).resolves.not.toThrow();
    expect(screen.getByTestId('widget')).toHaveTextContent('lifi');
  });
});
