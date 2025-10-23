import { TestChainName, TokenStandard } from '@hyperlane-xyz/sdk';
import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import {
  createMockToken,
  createTokenConnectionMock,
  defaultTokenArgs,
  mockCollateralAddress,
} from '../../utils/test';
import * as tokenUtilsModule from './utils';
import {
  assembleTokensBySymbolChainMap,
  dedupeMultiCollateralTokens,
  getTokensWithSameCollateralAddresses,
  isValidMultiCollateralToken,
} from './utils';

const { isChainDisabledMock } = vi.hoisted(() => ({
  isChainDisabledMock: vi.fn(),
}));

vi.mock('../chains/utils', () => ({
  isChainDisabled: isChainDisabledMock,
}));

vi.mock('@hyperlane-xyz/utils', async () => {
  const actual =
    await vi.importActual<typeof import('@hyperlane-xyz/utils')>('@hyperlane-xyz/utils');
  return {
    ...actual,
    eqAddress: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
    normalizeAddress: (addr: string) => addr.toLowerCase(),
  };
});

describe('assembleTokensBySymbolChainMap', () => {
  const multiProvider = {
    tryGetChainMetadata: vi.fn((chainName: string) => ({ chainName, displayName: chainName })),
  } as any;

  beforeEach(() => {
    isChainDisabledMock.mockReset();
    isChainDisabledMock.mockReturnValue(false);
    multiProvider.tryGetChainMetadata.mockClear();
  });

  it('groups multi-chain tokens by symbol and chain', () => {
    const baseToken = createMockToken({
      symbol: 'MOCK',
      chainName: TestChainName.test1,
      connections: [
        createTokenConnectionMock(
          { chainName: TestChainName.test2 } as any,
          { chainName: TestChainName.test2, symbol: 'MOCK' } as any,
        ),
      ],
    });
    const sameSymbolToken = createMockToken({
      symbol: 'MOCK',
      chainName: TestChainName.test2,
      connections: [
        createTokenConnectionMock(
          { chainName: TestChainName.test1 } as any,
          { chainName: TestChainName.test1, symbol: 'MOCK' } as any,
        ),
      ],
    });

    const result = assembleTokensBySymbolChainMap([baseToken, sameSymbolToken], multiProvider);

    expect(Object.keys(result)).toEqual(['MOCK']);
    expect(result.MOCK.tokenInformation).toBe(baseToken);
    expect(result.MOCK.chains[TestChainName.test1].token).toBe(baseToken);
    expect(result.MOCK.chains[TestChainName.test2].token).toBe(sameSymbolToken);
  });

  it('skips chains that are disabled', () => {
    isChainDisabledMock.mockReturnValueOnce(true);
    const token = createMockToken({
      symbol: 'DISABLED',
      connections: [
        createTokenConnectionMock(
          { chainName: TestChainName.test2 } as any,
          { chainName: TestChainName.test2, symbol: 'DISABLED' } as any,
        ),
      ],
    });

    const result = assembleTokensBySymbolChainMap([token], multiProvider);

    expect(Object.keys(result)).toEqual(['DISABLED']);
    expect(result.DISABLED.chains).toEqual({});
    expect(multiProvider.tryGetChainMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('isValidMultiCollateralToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should return false if originToken has no collateralAddressOrDenom', () => {
    const token = createMockToken({ collateralAddressOrDenom: undefined });
    expect(isValidMultiCollateralToken(token, 'destination')).toBe(false);
  });

  test('should return false if originToken is not collateralized', () => {
    const token = createMockToken({ standard: TokenStandard.CosmosIbc });
    expect(isValidMultiCollateralToken(token, 'destination')).toBe(false);
  });

  test('should return false if destinationToken is not found via chain name', () => {
    const token = createMockToken({ connections: [createTokenConnectionMock()] });
    expect(isValidMultiCollateralToken(token, 'destination')).toBe(false);
  });

  test('should return false if destinationToken has no collateralAddressOrDenom', () => {
    const token = createMockToken({
      connections: [createTokenConnectionMock(undefined, { collateralAddressOrDenom: undefined })],
    });
    expect(isValidMultiCollateralToken(token, TestChainName.test2)).toBe(false);
  });

  test('should return false if destinationToken is not collateralized', () => {
    const token = createMockToken({
      connections: [createTokenConnectionMock(undefined, { standard: TokenStandard.CosmosIbc })],
    });
    expect(isValidMultiCollateralToken(token, TestChainName.test2)).toBe(false);
  });

  test('should return true when tokens are valid with destinationToken as a string', () => {
    const token = createMockToken({
      connections: [createTokenConnectionMock()],
    });
    expect(isValidMultiCollateralToken(token, TestChainName.test2)).toBe(true);
  });

  test('should return true when tokens are valid with destinationToken as a IToken', () => {
    const token = createMockToken({
      connections: [createTokenConnectionMock()],
    });
    const destinationToken = token.getConnectionForChain(TestChainName.test2)!.token;
    expect(isValidMultiCollateralToken(token, destinationToken)).toBe(true);
  });
});

describe('getTokensWithSameCollateralAddresses', () => {
  const warpCore = {
    getTokensForRoute: vi.fn(),
  } as any;

  const origin = TestChainName.test1;
  const destination = TestChainName.test2;

  beforeEach(() => {
    warpCore.getTokensForRoute.mockReset();
  });

  it('returns tokens matching normalized collateral addresses', () => {
    const destinationToken = {
      chainName: destination,
      protocol: 'ethereum',
      collateralAddressOrDenom: '0xdef',
      standard: TokenStandard.EvmHypCollateral,
    } as any;
    const originToken = {
      chainName: origin,
      protocol: 'ethereum',
      collateralAddressOrDenom: mockCollateralAddress,
      standard: TokenStandard.EvmHypCollateral,
      getConnectionForChain: (chainName: string) =>
        chainName === destination ? { token: destinationToken } : undefined,
    } as any;

    const matchingOriginToken = { ...originToken };

    warpCore.getTokensForRoute.mockReturnValue([matchingOriginToken]);
    const isValidSpy = vi
      .spyOn(tokenUtilsModule, 'isValidMultiCollateralToken')
      .mockReturnValue(true);

    const result = getTokensWithSameCollateralAddresses(warpCore, originToken, destinationToken);

    expect(result).toEqual([{ originToken: matchingOriginToken, destinationToken }]);

    isValidSpy.mockRestore();
  });

  it('returns empty array when no matches found', () => {
    const originToken = createMockToken({
      chainName: origin,
      collateralAddressOrDenom: mockCollateralAddress,
      connections: [createTokenConnectionMock()],
    });
    const destinationToken = originToken.getConnectionForChain(destination)!.token;

    warpCore.getTokensForRoute.mockReturnValue([]);

    const result = getTokensWithSameCollateralAddresses(warpCore, originToken, destinationToken);

    expect(result).toEqual([]);
  });
});

describe('dedupeMultiCollateralTokens', () => {
  const destination = TestChainName.test2;

  const createMultiCollateralToken = (overrides?: Partial<typeof defaultTokenArgs>) =>
    createMockToken({
      ...overrides,
      connections: [createTokenConnectionMock(undefined, overrides)],
    });

  it('groups tokens sharing collateral addresses and keeps a single representative', () => {
    const baseToken = createMultiCollateralToken({ symbol: 'BASE' });
    const duplicateToken = createMultiCollateralToken({ symbol: 'BASE' });
    const uniqueToken = createMultiCollateralToken({
      symbol: 'UNIQUE',
      collateralAddressOrDenom: '0x987',
    });

    const { tokens, multiCollateralTokenMap } = dedupeMultiCollateralTokens(
      [
        { token: baseToken, disabled: false },
        { token: duplicateToken, disabled: false },
        { token: uniqueToken, disabled: false },
      ],
      destination,
    );

    expect(tokens).toHaveLength(2);
    expect(tokens.find((t) => t.token === baseToken)).toBeDefined();
    expect(tokens.find((t) => t.token === uniqueToken)).toBeDefined();

    const originAddress = baseToken.collateralAddressOrDenom!.toLowerCase();
    const destinationAddress = baseToken
      .getConnectionForChain(destination)!
      .token.collateralAddressOrDenom!.toLowerCase();

    expect(multiCollateralTokenMap[originAddress][destinationAddress]).toHaveLength(2);
    expect(multiCollateralTokenMap[originAddress][destinationAddress]).toEqual(
      expect.arrayContaining([baseToken, duplicateToken]),
    );
  });

  it('passes through tokens that are not multi-collateralized', () => {
    const simpleToken = createMockToken({
      standard: TokenStandard.CosmosIbc,
      collateralAddressOrDenom: undefined,
      connections: [],
    });

    const { tokens, multiCollateralTokenMap } = dedupeMultiCollateralTokens(
      [{ token: simpleToken, disabled: false }],
      destination,
    );

    expect(tokens).toEqual([{ token: simpleToken, disabled: false }]);
    expect(multiCollateralTokenMap).toEqual({});
  });
});
