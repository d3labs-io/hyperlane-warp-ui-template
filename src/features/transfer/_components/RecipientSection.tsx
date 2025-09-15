import { useFormikContext } from 'formik';
import { TextField } from '../../../components/input/TextField';
import { useDestinationBalance } from '../../tokens/balances';
import { useRecipientBalanceWatcher } from '../_hooks/useBalanceWatcher';
import { TransferFormValues } from '../types';
import SelfButton from './SelfButton';
import TokenBalance from './TokenBalance';

export default function RecipientSection({ isReview }: { isReview: boolean }) {
  const { values } = useFormikContext<TransferFormValues>();
  const { balance } = useDestinationBalance(values);
  useRecipientBalanceWatcher(values.recipient, balance);

  return (
    <div className="mt-4">
      <div className="flex justify-between pr-1">
        <label htmlFor="recipient" className="block pl-0.5 text-sm text-gray-600">
          Recipient address
        </label>
        <TokenBalance label="Remote balance" balance={balance} />
      </div>
      <div className="relative w-full">
        <TextField
          name="recipient"
          placeholder="0x123456..."
          className="w-full"
          disabled={isReview}
        />
        <SelfButton disabled={isReview} />
      </div>
    </div>
  );
}
