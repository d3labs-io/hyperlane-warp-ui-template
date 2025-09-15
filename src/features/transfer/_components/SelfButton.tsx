import { useAccountAddressForChain } from '@hyperlane-xyz/widgets';
import { useFormikContext } from 'formik';
import { toast } from 'react-toastify';
import { SolidButton } from '../../../components/buttons/SolidButton';
import { useChainDisplayName, useMultiProvider } from '../../chains/hooks';
import { TransferFormValues } from '../types';

export default function SelfButton({ disabled }: { disabled?: boolean }) {
  const { values, setFieldValue } = useFormikContext<TransferFormValues>();
  const multiProvider = useMultiProvider();
  const chainDisplayName = useChainDisplayName(values.destination);
  const address = useAccountAddressForChain(multiProvider, values.destination);
  const onClick = () => {
    if (disabled) return;
    if (address) setFieldValue('recipient', address);
    else
      toast.warn(`No account found for for chain ${chainDisplayName}, is your wallet connected?`);
  };
  return (
    <SolidButton
      type="button"
      onClick={onClick}
      color="primary"
      disabled={disabled}
      className="absolute bottom-1 right-1 top-2.5 px-2 text-xs opacity-90 all:rounded"
    >
      Self
    </SolidButton>
  );
}
