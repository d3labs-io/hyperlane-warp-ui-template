import { ChevronIcon, useModal } from '@hyperlane-xyz/widgets';
import { Skeleton } from '@interchain-ui/react';
import { Color } from '../../styles/Color';
import { TransferFeeModal } from './TransferFeeModal';

export function FeeSectionButton({
  isLoading,
  fees,
  visible,
}: {
  isLoading: boolean;
  fees: { totalFees: string; localQuote: any; interchainQuote: any } | null;
  visible: boolean;
}) {
  const { close, isOpen, open } = useModal();

  if (!visible) return null;

  return (
    <>
      <div className="mt-2 h-2">
        {isLoading ? (
          <Skeleton />
        ) : fees ? (
          <button
            className="flex w-fit items-center text-xxs text-gray-600 hover:text-gray-500 [&_path]:fill-gray-600 [&_path]:hover:fill-gray-500"
            type="button"
            onClick={open}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              className="mr-1"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3zm-2 0v16H5V5h9zm5.707 4.293a1 1 0 0 0-1.414 0l-1 1A1 1 0 0 0 17 9v7a1 1 0 0 0 2 0v-6.586l.293-.293a1 1 0 0 0 0-1.414z"
                fill={Color.gray[600]}
              />
            </svg>
            Fees: {fees.totalFees}
            <ChevronIcon direction="e" width="0.6rem" height="0.6rem" />
          </button>
        ) : null}
      </div>
      <TransferFeeModal close={close} isOpen={isOpen} isLoading={isLoading} fees={fees} />
    </>
  );
}
