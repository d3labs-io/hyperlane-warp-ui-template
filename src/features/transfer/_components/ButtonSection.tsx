import { Token, WarpCore } from '@hyperlane-xyz/sdk';
import { ChevronIcon } from '@hyperlane-xyz/widgets';
import { useFormikContext } from 'formik';
import { ConnectAwareSubmitButton } from '../../../components/buttons/ConnectAwareSubmitButton';
import { SolidButton } from '../../../components/buttons/SolidButton';
import { Color } from '../../../styles/Color';
import { logger } from '../../../utils/logger';
import { useChainDisplayName } from '../../chains/hooks';
import { useIsAccountSanctioned } from '../../sanctions/hooks/useIsAccountSanctioned';
import { useStore } from '../../store';
import { getIndexForToken } from '../../tokens/hooks';
import { useTokenTransfer } from '../_hooks/useTokenTransfer';
import { TransferFormValues } from '../types';

export default function ButtonSection({
  isReview,
  isValidating,
  setIsReview,
  cleanOverrideToken,
  routeOverrideToken,
  warpCore,
}: {
  isReview: boolean;
  isValidating: boolean;
  setIsReview: (b: boolean) => void;
  cleanOverrideToken: () => void;
  routeOverrideToken: Token | null;
  warpCore: WarpCore;
}) {
  const { values } = useFormikContext<TransferFormValues>();
  const chainDisplayName = useChainDisplayName(values.destination);

  const isSanctioned = useIsAccountSanctioned();

  const onDoneTransactions = () => {
    setIsReview(false);
    setTransferLoading(false);
    cleanOverrideToken();
    // resetForm();
  };
  const { triggerTransactions } = useTokenTransfer(onDoneTransactions);

  const { setTransferLoading } = useStore((s) => ({
    setTransferLoading: s.setTransferLoading,
  }));

  const triggerTransactionsHandler = async () => {
    try {
      if (isSanctioned) {
        return;
      }
      setIsReview(false);
      setTransferLoading(true);
      let tokenIndex = values.tokenIndex;
      let origin = values.origin;

      if (routeOverrideToken) {
        tokenIndex = getIndexForToken(warpCore, routeOverrideToken);
        origin = routeOverrideToken.chainName;
      }
      await triggerTransactions({ ...values, tokenIndex, origin });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Transaction Error', err?.message);
    }
  };

  const onEdit = () => {
    setIsReview(false);
    cleanOverrideToken();
  };
  if (!isReview) {
    return (
      <ConnectAwareSubmitButton
        chainName={values.origin}
        text={isValidating ? 'Validating...' : 'Continue'}
        classes="mt-4 px-3 py-1.5"
      />
    );
  }

  return (
    <div className="mt-4 flex items-center justify-between space-x-4">
      <SolidButton
        type="button"
        color="accent"
        onClick={onEdit}
        className="px-6 py-1.5"
        icon={<ChevronIcon direction="w" width={10} height={6} color={Color.white} />}
      >
        <span>Edit</span>
      </SolidButton>
      <SolidButton
        type="button"
        color="primary"
        onClick={triggerTransactionsHandler}
        className="flex-1 px-3 py-1.5"
      >
        {`Send to ${chainDisplayName}`}
      </SolidButton>
    </div>
  );
}
