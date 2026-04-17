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

const MODE_STORAGE_KEY = 'bridge-swap.aggregator';
const DISCLAIMER_STORAGE_KEY = 'bridge-swap.disclaimer-accepted';

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

  describe('disclaimer gate', () => {
    it('shows the gate and hides the widget on first load', async () => {
      render(<BridgeSwapCard />);
      expect(await screen.findByRole('heading', { name: /third-party service/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
      expect(screen.queryByTestId('widget')).not.toBeInTheDocument();
    });

    it('keeps the Continue button disabled until the checkbox is checked', async () => {
      const user = userEvent.setup();
      render(<BridgeSwapCard />);
      const button = await screen.findByRole('button', { name: /continue/i });
      expect(button).toBeDisabled();
      await user.click(screen.getByRole('checkbox'));
      expect(button).toBeEnabled();
    });

    it('reveals the widget and persists acceptance on Continue', async () => {
      const user = userEvent.setup();
      render(<BridgeSwapCard />);
      await user.click(await screen.findByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /continue/i }));

      expect(await screen.findByTestId('widget')).toBeInTheDocument();
      expect(storage.setItem).toHaveBeenCalledWith(DISCLAIMER_STORAGE_KEY, '1');
    });

    it('skips the gate when acceptance is already stored', async () => {
      storage.setItem(DISCLAIMER_STORAGE_KEY, '1');
      render(<BridgeSwapCard />);
      expect(await screen.findByTestId('widget')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /third-party service/i })).not.toBeInTheDocument();
    });

    it('does not throw if localStorage.setItem fails when accepting', async () => {
      const user = userEvent.setup();
      render(<BridgeSwapCard />);
      await user.click(await screen.findByRole('checkbox'));
      storage.setItem.mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      await expect(
        user.click(screen.getByRole('button', { name: /continue/i })),
      ).resolves.not.toThrow();
      expect(await screen.findByTestId('widget')).toBeInTheDocument();
    });
  });

  describe('aggregator mode (after disclaimer accepted)', () => {
    beforeEach(() => {
      storage.setItem(DISCLAIMER_STORAGE_KEY, '1');
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
      storage.setItem(MODE_STORAGE_KEY, 'lifi');
      render(<BridgeSwapCard />);
      await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('lifi'));
    });

    it('prefers URL param over localStorage', async () => {
      storage.setItem(MODE_STORAGE_KEY, 'lifi');
      setLocation('?aggregator=jumper');
      render(<BridgeSwapCard />);
      await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('jumper'));
    });

    it('ignores garbage values in both the URL and storage', async () => {
      storage.setItem(MODE_STORAGE_KEY, 'banana');
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
      expect(storage.setItem).toHaveBeenCalledWith(MODE_STORAGE_KEY, 'lifi');
    });

    it('does not throw if localStorage.getItem fails (e.g. Safari private mode)', async () => {
      storage.getItem.mockImplementation(() => {
        throw new Error('storage disabled');
      });
      expect(() => render(<BridgeSwapCard />)).not.toThrow();
      // When getItem throws, the disclaimer gate stays (we treat unknown as "not accepted").
      expect(
        await screen.findByRole('heading', { name: /third-party service/i }),
      ).toBeInTheDocument();
    });

    it('does not throw if localStorage.setItem fails on mode change', async () => {
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
});
