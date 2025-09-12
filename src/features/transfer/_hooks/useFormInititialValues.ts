import { useMemo } from 'react';
import { WARP_QUERY_PARAMS } from '../../../consts/args';
import { config } from '../../../consts/config';
import { getQueryParams } from '../../../utils/queryParams';
import { tryGetValidChainName } from '../../chains/utils';
import { getInitialTokenIndex, useWarpCore } from '../../tokens/hooks';
import { TransferFormValues } from '../types';

export default function useFormInitialValues(): TransferFormValues {
  const warpCore = useWarpCore();
  const params = getQueryParams();

  const originQuery = tryGetValidChainName(
    params.get(WARP_QUERY_PARAMS.ORIGIN),
    warpCore.multiProvider,
  );
  const destinationQuery = tryGetValidChainName(
    params.get(WARP_QUERY_PARAMS.DESTINATION),
    warpCore.multiProvider,
  );
  const defaultOriginToken = config.defaultOriginChain
    ? warpCore.getTokensForChain(config.defaultOriginChain)?.[0]
    : undefined;

  const tokenIndex = getInitialTokenIndex(
    warpCore,
    params.get(WARP_QUERY_PARAMS.TOKEN),
    originQuery,
    destinationQuery,
    defaultOriginToken,
    config.defaultDestinationChain,
  );

  const feeTokenIndex =
    (params.get(WARP_QUERY_PARAMS.FEE_TOKEN) &&
      getInitialTokenIndex(
        warpCore,
        params.get(WARP_QUERY_PARAMS.FEE_TOKEN),
        originQuery,
        destinationQuery,
        defaultOriginToken,
        config.defaultDestinationChain,
      )) ||
    undefined;

  return useMemo(() => {
    const firstToken = defaultOriginToken || warpCore.tokens[0];
    const connectedToken = firstToken.connections?.[0];
    const chainsValid = originQuery && destinationQuery;

    return {
      origin: chainsValid ? originQuery : firstToken.chainName,
      destination: chainsValid
        ? destinationQuery
        : config.defaultDestinationChain || connectedToken?.token?.chainName || '',
      tokenIndex: tokenIndex,
      feeTokenIndex: feeTokenIndex,
      amount: '',
      recipient: '',
    };
  }, [warpCore, destinationQuery, originQuery, tokenIndex, defaultOriginToken, feeTokenIndex]);
}
