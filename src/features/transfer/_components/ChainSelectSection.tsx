import { useFormikContext } from 'formik';
import { useMemo } from 'react';
import { WARP_QUERY_PARAMS } from '../../../consts/args';
import { updateQueryParam } from '../../../utils/queryParams';
import { ChainSelectField } from '../../chains/ChainSelectField';
import { getNumRoutesWithSelectedChain } from '../../chains/utils';
import { useStore } from '../../store';
import { getTokenByIndex, getTokenIndexFromChains, useWarpCore } from '../../tokens/hooks';
import { TransferFormValues } from '../types';
import SwapChainsButton from './SwapChainsButton';

export default function ChainSelectSection({ isReview }: { isReview: boolean }) {
  const warpCore = useWarpCore();

  const { setOriginChainName } = useStore((s) => ({
    setOriginChainName: s.setOriginChainName,
  }));

  const { values, setFieldValue } = useFormikContext<TransferFormValues>();

  const originRouteCounts = useMemo(() => {
    return getNumRoutesWithSelectedChain(warpCore, values.origin, true);
  }, [values.origin, warpCore]);

  const destinationRouteCounts = useMemo(() => {
    return getNumRoutesWithSelectedChain(warpCore, values.destination, false);
  }, [values.destination, warpCore]);

  const setTokenOnChainChange = (origin: string, destination: string) => {
    const tokenIndex = getTokenIndexFromChains(warpCore, null, origin, destination);
    const token = getTokenByIndex(warpCore, tokenIndex);
    updateQueryParam(WARP_QUERY_PARAMS.TOKEN, token?.addressOrDenom);
    setFieldValue('tokenIndex', tokenIndex);
  };

  const handleChange = (chainName: string, fieldName: string) => {
    if (fieldName === WARP_QUERY_PARAMS.ORIGIN) {
      setTokenOnChainChange(chainName, values.destination);
      setOriginChainName(chainName);
    } else if (fieldName === WARP_QUERY_PARAMS.DESTINATION) {
      setTokenOnChainChange(values.origin, chainName);
    }
    updateQueryParam(fieldName, chainName);
  };

  const onSwapChain = (origin: string, destination: string) => {
    updateQueryParam(WARP_QUERY_PARAMS.ORIGIN, origin);
    updateQueryParam(WARP_QUERY_PARAMS.DESTINATION, destination);
    setTokenOnChainChange(origin, destination);
    setOriginChainName(origin);
  };

  return (
    <div className="mt-2 flex items-center justify-between gap-4">
      <ChainSelectField
        name="origin"
        label="From"
        disabled={isReview}
        customListItemField={destinationRouteCounts}
        onChange={handleChange}
      />
      <div className="flex flex-1 flex-col items-center">
        <SwapChainsButton disabled={isReview} onSwapChain={onSwapChain} />
      </div>
      <ChainSelectField
        name="destination"
        label="To"
        disabled={isReview}
        customListItemField={originRouteCounts}
        onChange={handleChange}
      />
    </div>
  );
}
