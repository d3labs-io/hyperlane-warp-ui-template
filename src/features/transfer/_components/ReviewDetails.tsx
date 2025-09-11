import { Token } from '@hyperlane-xyz/sdk';
import { convertToScaledAmount, fromWei, objKeys, toWei } from '@hyperlane-xyz/utils';
import { SpinnerIcon } from '@hyperlane-xyz/widgets';
import { useFormikContext } from 'formik';
import { useMemo } from 'react';
import { chainsRentEstimate } from '../../../consts/chains';
import { config } from '../../../consts/config';
import { useIsApproveRequired } from '../../tokens/approval';
import { getTokenByIndex, useWarpCore } from '../../tokens/hooks';
import { useFeeQuotes } from '../_hooks/useFeeQuotes';
import { TransferFormValues } from '../types';

export default function ReviewDetails({
  visible,
  routeOverrideToken,
}: {
  visible: boolean;
  routeOverrideToken: Token | null;
}) {
  const { values } = useFormikContext<TransferFormValues>();
  const { amount, destination, tokenIndex } = values;
  const warpCore = useWarpCore();
  const originToken = routeOverrideToken || getTokenByIndex(warpCore, tokenIndex);
  const originTokenSymbol = originToken?.symbol || '';
  const connection = originToken?.getConnectionForChain(destination);
  const destinationToken = connection?.token;
  const isNft = originToken?.isNft();

  const scaledAmount = useMemo(() => {
    if (!originToken?.scale || !destinationToken?.scale) return null;
    if (!visible || originToken.scale === destinationToken.scale) return null;

    const amountWei = toWei(amount, originToken.decimals);
    const precisionFactor = 100000;

    const convertedAmount = convertToScaledAmount({
      amount: BigInt(amountWei),
      fromScale: originToken.scale,
      toScale: destinationToken.scale,
      precisionFactor,
    });
    const value = convertedAmount / BigInt(precisionFactor);

    return {
      value: fromWei(value.toString(), originToken.decimals),
      originScale: originToken.scale,
      destinationScale: destinationToken.scale,
    };
  }, [amount, originToken, destinationToken, visible]);

  const amountWei = isNft ? amount.toString() : toWei(amount, originToken?.decimals);

  const { isLoading: isApproveLoading, isApproveRequired } = useIsApproveRequired(
    originToken,
    amountWei,
    visible,
  );
  const { isLoading: isQuoteLoading, fees } = useFeeQuotes(values, visible);

  const isLoading = isApproveLoading || isQuoteLoading;

  const interchainQuote =
    originToken && objKeys(chainsRentEstimate).includes(originToken.chainName)
      ? fees?.interchainQuote.plus(chainsRentEstimate[originToken.chainName])
      : fees?.interchainQuote;

  const showPruvOriginUSDCFee =
    config.enablePruvOriginFeeUSDC &&
    values.origin.startsWith('pruv') &&
    originToken?.symbol === 'USDC' &&
    config.pruvOriginFeeUSDC[values.destination];

  return (
    <div
      className={`${
        visible ? 'max-h-screen duration-1000 ease-in' : 'max-h-0 duration-500'
      } overflow-hidden transition-all`}
    >
      <label className="mt-4 block pl-0.5 text-sm text-gray-600">Transactions</label>
      <div className="mt-1.5 space-y-2 break-all rounded border border-gray-400 bg-gray-150 px-2.5 py-2 text-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <SpinnerIcon className="h-5 w-5" />
          </div>
        ) : (
          <>
            {isApproveRequired && (
              <div>
                <h4>Transaction 1: Approve Transfer</h4>
                <div className="ml-1.5 mt-1.5 space-y-1.5 border-l border-gray-300 pl-2 text-xs">
                  <p>{`Router Address: ${originToken?.addressOrDenom}`}</p>
                  {originToken?.collateralAddressOrDenom && (
                    <p>{`Collateral Address: ${originToken.collateralAddressOrDenom}`}</p>
                  )}
                </div>
              </div>
            )}
            <div>
              <h4>{`Transaction${isApproveRequired ? ' 2' : ''}: Transfer Remote`}</h4>
              <div className="ml-1.5 mt-1.5 space-y-1.5 border-l border-gray-300 pl-2 text-xs">
                {destinationToken?.addressOrDenom && (
                  <p className="flex">
                    <span className="min-w-[7.5rem]">Remote Token</span>
                    <span>{destinationToken.addressOrDenom}</span>
                  </p>
                )}

                <p className="flex">
                  <span className="min-w-[7.5rem]">{isNft ? 'Token ID' : 'Amount'}</span>
                  <span>{`${amount} ${originTokenSymbol}`}</span>
                </p>
                {scaledAmount && (
                  <p className="flex">
                    <span className="min-w-[7.5rem]">Received Amount</span>
                    <span>{`${scaledAmount.value} ${originTokenSymbol} (scaled from ${scaledAmount.originScale} to ${scaledAmount.destinationScale})`}</span>
                  </p>
                )}
                {fees?.localQuote && fees.localQuote.amount > 0n && (
                  <p className="flex">
                    <span className="min-w-[7.5rem]">Local Gas (est.)</span>
                    <span>{`${fees.localQuote.getDecimalFormattedAmount().toFixed(4) || '0'} ${
                      fees.localQuote.token.symbol || ''
                    }`}</span>
                  </p>
                )}
                {interchainQuote && interchainQuote.amount > 0n && (
                  <p className="flex">
                    <span className="min-w-[7.5rem]">Bridge Fee</span>
                    <span>{`${interchainQuote.getDecimalFormattedAmount().toFixed(4) || '0'} ${
                      interchainQuote.token.symbol || ''
                    }`}</span>
                  </p>
                )}
                {showPruvOriginUSDCFee && (
                  <p className="flex">
                    <span className="min-w-[7.5rem]">Bridge Fee (USDC)</span>
                    <span>{`${config.pruvOriginFeeUSDC[values.destination]} USDC`}</span>
                  </p>
                )}
                {showPruvOriginUSDCFee && (
                  <p className="flex">
                    <span className="min-w-[7.5rem]">Amount Received</span>
                    <span className="font-bold">{`${(parseFloat(amount) - config.pruvOriginFeeUSDC[values.destination]).toFixed(2)} USDC`}</span>
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
