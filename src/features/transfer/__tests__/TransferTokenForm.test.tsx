import type { IToken, Token, WarpCore } from '@hyperlane-xyz/sdk';
import { TokenAmount } from '@hyperlane-xyz/sdk';
import { getAccountAddressAndPubKey } from '@hyperlane-xyz/widgets';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getQueryParams } from '../../../utils/queryParams';
import { tryGetValidChainName } from '../../chains/utils';
import { isMultiCollateralLimitExceeded } from '../../limits/utils';
import { getInitialTokenIndex, getTokenByIndex, useWarpCore } from '../../tokens/hooks';
import { getTokensWithSameCollateralAddresses } from '../../tokens/utils';
import { __testables } from '../TransferTokenForm';

vi.mock('../../tokens/hooks', () => ({
  useWarpCore: vi.fn(),
  getTokenByIndex: vi.fn(),
  getInitialTokenIndex: vi.fn(),
  getTokenIndexFromChains: vi.fn(),
  getIndexForToken: vi.fn(),
}));

vi.mock('../../chains/utils', () => ({
  getNumRoutesWithSelectedChain: vi.fn(),
  tryGetValidChainName: vi.fn(),
}));

vi.mock('../../../consts/config', () => ({
  config: {
    addressBlacklist: [],
    gaslessChains: [],
    enablePruvOriginFeeUSDC: false,
    pruvOriginFeeUSDC: {},
    pruvUSDCMetadata: { address: '0xUSDC' },
    defaultOriginChain: null,
    defaultDestinationChain: 'mock-destination',
  },
}));

vi.mock('../../../utils/queryParams', () => ({
  getQueryParams: vi.fn(() => new URLSearchParams()),
  updateQueryParam: vi.fn(),
}));

vi.mock('../../tokens/utils', () => ({
  getTokensWithSameCollateralAddresses: vi.fn(),
  isValidMultiCollateralToken: vi.fn(() => false),
}));

vi.mock('../../limits/utils', () => ({
  isMultiCollateralLimitExceeded: vi.fn(() => null),
}));

vi.mock('@hyperlane-xyz/widgets', () => ({
  getAccountAddressAndPubKey: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockUseWarpCore = vi.mocked(useWarpCore);
const mockGetTokenByIndex = vi.mocked(getTokenByIndex);
const mockGetInitialTokenIndex = vi.mocked(getInitialTokenIndex);
const mockTryGetValidChainName = vi.mocked(tryGetValidChainName);
const mockGetQueryParams = vi.mocked(getQueryParams);
const mockGetAccountAddressAndPubKey = vi.mocked(getAccountAddressAndPubKey);
const mockGetTokensWithSameCollateralAddresses = vi.mocked(getTokensWithSameCollateralAddresses);

describe('TransferTokenForm testables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useFormInitialValues', () => {
    it('returns defaults when query params missing', () => {
      const mockToken: Partial<Token> = {
        chainName: 'mock-origin',
        connections: [{ token: { chainName: 'mock-destination' } as Token }],
      };

      mockUseWarpCore.mockReturnValue({
        tokens: [mockToken],
        multiProvider: {},
        getTokensForChain: vi.fn(() => [mockToken]),
      } as unknown as WarpCore);
      mockGetInitialTokenIndex.mockReturnValue(0);
      mockTryGetValidChainName.mockImplementation((value) => value ?? undefined);
      mockGetQueryParams.mockReturnValue(new URLSearchParams());

      const { result } = renderHook(() => __testables.useFormInitialValues());

      expect(result.current.origin).toBe('mock-origin');
      expect(result.current.destination).toBe('mock-destination');
      expect(result.current.tokenIndex).toBe(0);
    });
  });

  describe('validateForm', () => {
    const baseWarpCore = {
      multiProvider: {},
      validateTransfer: vi.fn().mockResolvedValue(null),
    } as unknown as WarpCore;

    const baseValues = {
      origin: 'mock-origin',
      destination: 'mock-destination',
      tokenIndex: 0,
      amount: '1',
      recipient: '0xrecipient',
    };

    it('returns token error when token missing', async () => {
      mockGetTokenByIndex.mockReturnValue(undefined);

      const [errors] = await __testables.validateForm(baseWarpCore, baseValues, {} as any, {});

      expect(errors).toEqual({ token: 'Token is required' });
    });

    it('returns router address error when recipient matches blocked address', async () => {
      mockGetTokenByIndex.mockReturnValue({
        getConnectionForChain: () => ({ token: { symbol: 'TEST', decimals: 18 } }),
      } as unknown as Token);

      const routerMap: Record<ChainName, Set<string>> = {
        'mock-destination': new Set(['0xrecipient']),
      };

      const [errors] = await __testables.validateForm(
        baseWarpCore,
        baseValues,
        {} as any,
        routerMap,
      );

      expect(errors).toEqual({ recipient: 'Warp Route address is not valid as recipient' });
    });

    it('returns null errors when validation succeeds', async () => {
      const token = {
        chainName: 'mock-origin',
        decimals: 18,
        addressOrDenom: '0xabc',
        getConnectionForChain: () => ({ token: { decimals: 18, addressOrDenom: '0xdef' } }),
        getBalance: vi.fn(),
        amount: (wei: string) => ({ amount: wei, token: { decimals: 18 } }),
      } as unknown as Token;

      mockGetTokenByIndex.mockReturnValue(token);
      mockGetAccountAddressAndPubKey.mockReturnValue({
        address: '0xsender',
        publicKey: Promise.resolve('key'),
      });
      mockGetTokensWithSameCollateralAddresses.mockReturnValue([]);

      const [errors, overrideToken] = await __testables.validateForm(
        baseWarpCore,
        baseValues,
        {} as any,
        {},
      );

      expect(errors).toBeNull();
      expect(overrideToken).toBeNull();
      expect(isMultiCollateralLimitExceeded).toHaveBeenCalled();
    });
  });

  describe('formatFeePreview', () => {
    const usdcToken = {
      chainName: 'solanadevnet',
      decimals: 6,
      symbol: 'USDC',
      isFungibleWith: vi.fn(() => false),
    } as unknown as IToken;

    const multiProvider = {
      getChainMetadata: vi.fn(() => ({
        name: 'solanadevnet',
        nativeToken: { name: 'Solana', symbol: 'SOL', decimals: 9 },
      })),
    } as unknown as WarpCore['multiProvider'];

    it('keeps Solana rent in native units instead of adding it to USDC fees', () => {
      const feePreview = __testables.formatFeePreview(
        multiProvider,
        usdcToken as unknown as Token,
        {
          interchainQuote: new TokenAmount(0n, usdcToken),
          localQuote: new TokenAmount(0n, usdcToken),
        },
      );

      expect(feePreview?.interchainQuote.getDecimalFormattedAmount().toString()).toBe('0');
      expect(feePreview?.svmRentQuote?.token.symbol).toBe('SOL');
      expect(feePreview?.svmRentQuote?.getDecimalFormattedAmount().toString()).toBe('0.00203928');
      expect(feePreview?.totalFees).toBe('0.0020 SOL');
    });

    it('does not add rent for non-SVM origins', () => {
      const evmToken = {
        chainName: 'pruvtest',
        decimals: 6,
        symbol: 'USDC',
        isFungibleWith: vi.fn(() => false),
      } as unknown as IToken;

      const feePreview = __testables.formatFeePreview(multiProvider, evmToken as unknown as Token, {
        interchainQuote: new TokenAmount(1000000n, evmToken),
        localQuote: new TokenAmount(0n, evmToken),
      });

      expect(feePreview?.svmRentQuote).toBeNull();
      expect(feePreview?.totalFees).toBe('1.0000 USDC');
    });
  });
});
