import { IRegistry } from '@hyperlane-xyz/registry';
import { TokenStandard, WarpCoreConfig } from '@hyperlane-xyz/sdk';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { assembleWarpCoreConfig } from '../warpCoreConfig';

// Mock dependencies
vi.mock('../../../consts/config.ts', () => ({
  config: {
    useOnlineRegistry: true,
    registryUrl: null,
  },
}));

vi.mock('../../../consts/warpRouteWhitelist.ts', () => ({
  warpRouteWhitelist: null,
}));

vi.mock('../../../consts/warpRoutes.ts', () => ({
  warpRouteConfigs: {
    tokens: [
      {
        chainName: 'ethereum',
        addressOrDenom: '0x123',
        name: 'Token A',
      },
    ],
    options: {},
  },
}));

vi.mock('../../../consts/warpRoutes.yaml', () => ({
  default: {
    tokens: [
      {
        chainName: 'polygon',
        addressOrDenom: '0x456',
        name: 'Token B',
      },
    ],
    options: {},
  },
}));

vi.mock('../../../utils/logger.ts', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

describe('assembleWarpCoreConfig', () => {
  let mockRegistry: IRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry = {
      getWarpRoutes: vi.fn(),
    } as unknown as IRegistry;
  });

  test.skip('should assemble config from all sources when useOnlineRegistry is true', async () => {
    const registryWarpRoutes = {
      route1: {
        tokens: [
          {
            chainName: 'arbitrum',
            addressOrDenom: '0x789',
            name: 'Token C',
            symbol: 'TOKC',
            decimals: 18,
            standard: TokenStandard.ERC20,
          },
        ],
        options: {},
      },
    };

    vi.mocked(mockRegistry.getWarpRoutes).mockResolvedValue(registryWarpRoutes);

    const storeOverrides: WarpCoreConfig[] = [
      {
        tokens: [
          {
            chainName: 'optimism',
            addressOrDenom: '0xabc',
            name: 'Token D',
            symbol: '',
            decimals: 0,
            standard: TokenStandard.ERC20,
          },
        ],
        options: {},
      },
    ];

    const result = await assembleWarpCoreConfig(storeOverrides, mockRegistry);

    expect(result.tokens).toHaveLength(4);
    expect(result.tokens.map((t) => t.chainName)).toContain('arbitrum');
    expect(result.tokens.map((t) => t.chainName)).toContain('ethereum');
    expect(result.tokens.map((t) => t.chainName)).toContain('polygon');
    expect(result.tokens.map((t) => t.chainName)).toContain('optimism');
  });
});
