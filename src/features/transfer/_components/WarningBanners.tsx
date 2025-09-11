import { useFormikContext } from 'formik';
import { ChainConnectionWarning } from '../../chains/ChainConnectionWarning';
import { ChainWalletWarning } from '../../chains/ChainWalletWarning';
import { WalletConnectionWarning } from '../../wallet/WalletConnectionWarning';
import { TransferFormValues } from '../types';

export default function WarningBanners() {
  const { values } = useFormikContext<TransferFormValues>();
  return (
    // Max height to prevent double padding if multiple warnings are visible
    <div className="max-h-10">
      <ChainWalletWarning origin={values.origin} />
      <ChainConnectionWarning origin={values.origin} destination={values.destination} />
      <WalletConnectionWarning origin={values.origin} />
    </div>
  );
}
