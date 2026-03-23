import { Token, TokenAmount, WarpCore } from '@hyperlane-xyz/sdk';
import { useQuery } from '@tanstack/react-query';
import BigNumber from 'bignumber.js';
import { config } from '../../consts/config';
import { logger } from '../../utils/logger';
import { getTokenByIndex, useWarpCore } from '../tokens/hooks';
import { TransferFormValues } from './types';

const FEE_QUOTE_REFRESH_INTERVAL = 15_000; // 15s

export function useFeeQuotes(
  { origin, destination, tokenIndex }: TransferFormValues,
  enabled: boolean,
) {
  const warpCore = useWarpCore();

  const shouldFetch = enabled && !!destination && typeof tokenIndex === 'number';
  const { isLoading, isError, data, isFetching } = useQuery({
    // The WarpCore class is not serializable, so we can't use it as a key
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: ['useFeeQuotes', origin, destination, tokenIndex],
    queryFn: () => fetchFeeQuotes(warpCore, destination, tokenIndex),
    enabled: shouldFetch,
    refetchInterval: FEE_QUOTE_REFRESH_INTERVAL,
  });

  return { isLoading: isLoading || isFetching, isError, fees: data };
}

export async function fetchFeeQuotes(
  warpCore: WarpCore,
  destination?: ChainName,
  tokenIndex?: number,
): Promise<{ interchainQuote: TokenAmount; localQuote: TokenAmount } | null> {
  const originToken = getTokenByIndex(warpCore, tokenIndex);
  if (!destination || !originToken) return null;

  logger.debug('Calculating custom fee quotes');
  const localQuote = getLocalGasQuote(warpCore, originToken);
  const interchainQuote =
    getCustomInterchainQuote(warpCore, originToken.chainName, destination) || originToken.amount(0);

  return {
    interchainQuote,
    localQuote,
  };
}

function getLocalGasQuote(warpCore: WarpCore, originToken: Token): TokenAmount {
  try {
    const chainMetadata = warpCore.multiProvider.getChainMetadata(originToken.chainName);
    const nativeToken = Token.FromChainMetadataNativeToken(chainMetadata);
    return nativeToken.amount(0);
  } catch {
    return originToken.amount(0);
  }
}

function getCustomInterchainQuote(
  warpCore: WarpCore,
  originChain: ChainName,
  destination: ChainName,
): TokenAmount | null {
  const pruvQuote = getPruvBridgeFeeQuote(warpCore, originChain, destination);
  if (pruvQuote) return pruvQuote;
  return null;
}

function getPruvBridgeFeeQuote(
  warpCore: WarpCore,
  originChain: ChainName,
  destination: ChainName,
): TokenAmount | null {
  if (!config.enablePruvOriginFeeUSDC) return null;
  if (!originChain?.toLowerCase().startsWith('pruv')) return null;
  const feeValue = config.pruvOriginFeeUSDC[destination];
  if (!feeValue) return null;

  const usdcToken =
    warpCore.tokens.find(
      (token) => token.chainName === originChain && token.symbol.toUpperCase() === 'USDC',
    ) || null;

  if (!usdcToken) return null;

  const scaledAmount = new BigNumber(feeValue)
    .shiftedBy(usdcToken.decimals)
    .integerValue(BigNumber.ROUND_FLOOR);

  if (!scaledAmount.isFinite() || scaledAmount.lte(0)) return null;

  return usdcToken.amount(scaledAmount.toFixed(0));
}
