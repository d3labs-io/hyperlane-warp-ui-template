import { IconButton } from '@hyperlane-xyz/widgets';
import { useFormikContext } from 'formik';
import { CustomSwapIcon } from '../../../components/icons/CustomSwapIcon';
import { TransferFormValues } from '../types';

export default function SwapChainsButton({
  disabled,
  onSwapChain,
}: {
  disabled?: boolean;
  onSwapChain: (origin: string, destination: string) => void;
}) {
  const { values, setFieldValue } = useFormikContext<TransferFormValues>();
  const { origin, destination } = values;

  const onClick = () => {
    if (disabled) return;
    setFieldValue('origin', destination);
    setFieldValue('destination', origin);
    // Reset other fields on chain change
    setFieldValue('recipient', '');
    onSwapChain(destination, origin);
  };

  return (
    <IconButton
      width={20}
      height={20}
      title="Swap chains"
      className={!disabled ? 'hover:rotate-180' : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <CustomSwapIcon width={20} height={20} />
    </IconButton>
  );
}
