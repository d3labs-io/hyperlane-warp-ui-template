import { TokenAmount } from '@hyperlane-xyz/sdk';
import { isNullish } from '@hyperlane-xyz/utils';
import { SpinnerIcon, useAccounts } from '@hyperlane-xyz/widgets';
import BigNumber from 'bignumber.js';
import { useFormikContext } from 'formik';
import { SolidButton } from '../../../components/buttons/SolidButton';
import { useMultiProvider } from '../../chains/hooks';
import { useFetchMaxAmount } from '../_utils/maxAmount';
import { TransferFormValues } from '../types';

export default function MaxButton({
  balance,
  disabled,
}: {
  balance?: TokenAmount;
  disabled?: boolean;
}) {
  const { values, setFieldValue } = useFormikContext<TransferFormValues>();
  const { origin, destination, tokenIndex } = values;
  const multiProvider = useMultiProvider();
  const { accounts } = useAccounts(multiProvider);
  const { fetchMaxAmount, isLoading } = useFetchMaxAmount();

  const onClick = async () => {
    if (!balance || isNullish(tokenIndex) || disabled) return;
    const maxAmount = await fetchMaxAmount({ balance, origin, destination, accounts });
    if (isNullish(maxAmount)) return;
    const decimalsAmount = maxAmount.getDecimalFormattedAmount();
    const roundedAmount = new BigNumber(decimalsAmount).toFixed(4, BigNumber.ROUND_FLOOR);
    setFieldValue('amount', roundedAmount);
  };

  return (
    <SolidButton
      type="button"
      onClick={onClick}
      color="primary"
      disabled={disabled}
      className="absolute bottom-1 right-1 top-2.5 px-2 text-xs opacity-90 all:rounded"
    >
      {isLoading ? (
        <div className="flex items-center">
          <SpinnerIcon className="h-5 w-5" color="white" />
        </div>
      ) : (
        'Max'
      )}
    </SolidButton>
  );
}
