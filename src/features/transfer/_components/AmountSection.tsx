import { useFormikContext } from 'formik';
import { TextField } from '../../../components/input/TextField';
import { useOriginBalance } from '../../tokens/balances';
import { SelectOrInputTokenIds } from '../../tokens/SelectOrInputTokenIds';
import { TransferFormValues } from '../types';
import MaxButton from './MaxButton';
import TokenBalance from './TokenBalance';

export default function AmountSection({ isNft, isReview }: { isNft: boolean; isReview: boolean }) {
  const { values } = useFormikContext<TransferFormValues>();
  const { balance } = useOriginBalance(values);

  return (
    <div className="flex-1">
      <div className="flex justify-between pr-1">
        <label htmlFor="amount" className="block pl-0.5 text-sm text-gray-600">
          Amount
        </label>
        <TokenBalance label="My balance" balance={balance} />
      </div>
      {isNft ? (
        <SelectOrInputTokenIds disabled={isReview} />
      ) : (
        <div className="relative w-full">
          <TextField
            name="amount"
            placeholder="0.00"
            className="w-full"
            type="number"
            step="any"
            disabled={isReview}
          />
          <MaxButton disabled={isReview} balance={balance} />
        </div>
      )}
    </div>
  );
}
