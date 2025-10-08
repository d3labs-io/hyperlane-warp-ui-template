import {
  EvmTokenAdapter,
  ProviderType,
  TypedTransactionReceipt,
  WarpCore,
  WarpTxCategory,
} from '@hyperlane-xyz/sdk';
import { toTitleCase, toWei } from '@hyperlane-xyz/utils';
import {
  getAccountAddressForChain,
  useAccounts,
  useActiveChains,
  useTransactionFns,
} from '@hyperlane-xyz/widgets';
import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import { toastTxSuccess } from '../../components/toast/TxSuccessToast';
import { config } from '../../consts/config';
import { logger } from '../../utils/logger';
import { useMultiProvider } from '../chains/hooks';
import { getChainDisplayName } from '../chains/utils';
import { AppState, useStore } from '../store';
import { getTokenByIndex, useWarpCore } from '../tokens/hooks';
import { TransferContext, TransferFormValues, TransferStatus } from './types';
import { tryGetMsgIdFromTransferReceipt } from './utils';
import { getAmountWithPruvUsdcBonus, getPruvOriginFeeUSDC } from './pruvFee';

const CHAIN_MISMATCH_ERROR = 'ChainMismatchError';
const TRANSFER_TIMEOUT_ERROR1 = 'block height exceeded';
const TRANSFER_TIMEOUT_ERROR2 = 'timeout';

export function useTokenTransfer(onDone?: () => void) {
  const { transfers, addTransfer, updateTransferStatus } = useStore((s) => ({
    transfers: s.transfers,
    addTransfer: s.addTransfer,
    updateTransferStatus: s.updateTransferStatus,
  }));
  const transferIndex = transfers.length;

  const multiProvider = useMultiProvider();
  const warpCore = useWarpCore();

  const activeAccounts = useAccounts(multiProvider);
  const activeChains = useActiveChains(multiProvider);
  const transactionFns = useTransactionFns(multiProvider);

  const [isLoading, setIsLoading] = useState(false);

  // TODO implement cancel callback for when modal is closed?
  const triggerTransactions = useCallback(
    (values: TransferFormValues) =>
      executeTransfer({
        warpCore,
        values,
        transferIndex,
        activeAccounts,
        activeChains,
        transactionFns,
        addTransfer,
        updateTransferStatus,
        setIsLoading,
        onDone,
      }),
    [
      warpCore,
      transferIndex,
      activeAccounts,
      activeChains,
      transactionFns,
      setIsLoading,
      addTransfer,
      updateTransferStatus,
      onDone,
    ],
  );

  return {
    isLoading,
    triggerTransactions,
  };
}

async function executeTransfer({
  warpCore,
  values,
  transferIndex,
  activeAccounts,
  activeChains,
  transactionFns,
  addTransfer,
  updateTransferStatus,
  setIsLoading,
  onDone,
}: {
  warpCore: WarpCore;
  values: TransferFormValues;
  transferIndex: number;
  activeAccounts: ReturnType<typeof useAccounts>;
  activeChains: ReturnType<typeof useActiveChains>;
  transactionFns: ReturnType<typeof useTransactionFns>;
  addTransfer: (t: TransferContext) => void;
  updateTransferStatus: AppState['updateTransferStatus'];
  setIsLoading: (b: boolean) => void;
  onDone?: () => void;
}) {
  logger.debug('Preparing transfer transaction(s)');
  setIsLoading(true);
  let transferStatus: TransferStatus = TransferStatus.Preparing;
  updateTransferStatus(transferIndex, transferStatus);

  const { origin, destination, tokenIndex, amount, recipient } = values;
  const multiProvider = warpCore.multiProvider;

  try {
    const originToken = getTokenByIndex(warpCore, tokenIndex);
    const connection = originToken?.getConnectionForChain(destination);
    if (!originToken || !connection) throw new Error('No token route found between chains');

    const originProtocol = originToken.protocol;
    const isNft = originToken.isNft();
    const amountForTransfer =
      !isNft
        ? getAmountWithPruvUsdcBonus({
            amount,
            origin,
            destination,
            tokenSymbol: originToken.symbol,
          })
        : amount;

    const weiAmountOrId = isNft
      ? amountForTransfer
      : toWei(amountForTransfer, originToken.decimals);
    const originTokenAmount = originToken.amount(weiAmountOrId);

    const sendTransaction = transactionFns[originProtocol].sendTransaction;
    const sendMultiTransaction = transactionFns[originProtocol].sendMultiTransaction;
    const activeChain = activeChains.chains[originProtocol];
    const sender = getAccountAddressForChain(multiProvider, origin, activeAccounts.accounts);
    if (!sender) throw new Error('No active account found for origin chain');

    const isCollateralSufficient = await warpCore.isDestinationCollateralSufficient({
      originTokenAmount,
      destination,
    });
    if (!isCollateralSufficient) {
      toast.error('Insufficient collateral on destination for transfer');
      throw new Error('Insufficient destination collateral');
    }

    addTransfer({
      timestamp: new Date().getTime(),
      status: TransferStatus.Preparing,
      origin,
      destination,
      originTokenAddressOrDenom: originToken.addressOrDenom,
      destTokenAddressOrDenom: connection.token.addressOrDenom,
      sender,
      recipient,
      amount,
    });

    updateTransferStatus(transferIndex, (transferStatus = TransferStatus.CreatingTxs));

    const txs = await warpCore.getTransferRemoteTxs({
      originTokenAmount,
      destination,
      sender,
      recipient,
    });

    // Add extra USDC approval transaction if origin is pruv and token is not USDC
    const shouldChargePruvFee =
      config.enablePruvOriginFeeUSDC && origin.startsWith('pruv') && !destination.startsWith('pruv');

    if (shouldChargePruvFee && originToken.symbol !== 'USDC') {
      const originProviderType = multiProvider.getProvider(origin).type;

      // Get the bridge fee for the destination chain from config
      const bridgeFeeUSDC = getPruvOriginFeeUSDC(destination);
      if (bridgeFeeUSDC > 0) {
        // Calculate amount with USDC decimals: bridgeFee * 10^decimals
        const usdcAmount = bridgeFeeUSDC * Math.pow(10, config.pruvUSDCMetadata.decimals);

        // Create EvmTokenAdapter for USDC contract
        const usdcTokenAdapter = new EvmTokenAdapter(origin, multiProvider, {
          token: config.pruvUSDCMetadata.address,
        });

        // Use populateApproveTx to create the approval transaction
        const populatedApprovalTx = await usdcTokenAdapter.populateApproveTx({
          weiAmountOrId: usdcAmount.toString(),
          recipient: originToken.addressOrDenom, // spender address
        });

        const usdcApprovalTx = {
          category: WarpTxCategory.Approval,
          type: originProviderType,
          transaction: populatedApprovalTx,
        } as any; // Type assertion to bypass TypeScript strict checking

        // Insert the usdc approval transaction at the beginning
        txs.unshift(usdcApprovalTx);
      }
    }

    const hashes: string[] = [];
    let txReceipt: TypedTransactionReceipt | undefined = undefined;

    if (txs.length > 1 && txs.every((tx) => tx.type === ProviderType.Starknet)) {
      updateTransferStatus(
        transferIndex,
        (transferStatus = txCategoryToStatuses[WarpTxCategory.Transfer][0]),
      );
      const { hash, confirm } = await sendMultiTransaction({
        txs,
        chainName: origin,
        activeChainName: activeChain.chainName,
      });
      updateTransferStatus(
        transferIndex,
        (transferStatus = txCategoryToStatuses[WarpTxCategory.Transfer][1]),
      );
      txReceipt = await confirm();
      const description = toTitleCase(WarpTxCategory.Transfer);
      logger.debug(`${description} transaction confirmed, hash:`, hash);
      toastTxSuccess(`${description} transaction sent!`, hash, origin);

      hashes.push(hash);
    } else {
      for (const tx of txs) {
        updateTransferStatus(
          transferIndex,
          (transferStatus = txCategoryToStatuses[tx.category][0]),
        );
        const { hash, confirm } = await sendTransaction({
          tx,
          chainName: origin,
          activeChainName: activeChain.chainName,
        });
        updateTransferStatus(
          transferIndex,
          (transferStatus = txCategoryToStatuses[tx.category][1]),
        );
        txReceipt = await confirm();
        const description = toTitleCase(tx.category);
        logger.debug(`${description} transaction confirmed, hash:`, hash);
        toastTxSuccess(`${description} transaction sent!`, hash, origin);

        hashes.push(hash);
      }
    }

    const msgId = txReceipt
      ? tryGetMsgIdFromTransferReceipt(multiProvider, origin, txReceipt)
      : undefined;

    updateTransferStatus(transferIndex, (transferStatus = TransferStatus.ConfirmedTransfer), {
      originTxHash: hashes.at(-1),
      msgId,
    });
  } catch (error: any) {
    logger.error(`Error at stage ${transferStatus}`, error);
    const errorDetails = error.message || error.toString();
    updateTransferStatus(transferIndex, TransferStatus.Failed);
    if (errorDetails.includes(CHAIN_MISMATCH_ERROR)) {
      // Wagmi switchNetwork call helps prevent this but isn't foolproof
      toast.error('Wallet must be connected to origin chain');
    } else if (
      errorDetails.includes(TRANSFER_TIMEOUT_ERROR1) ||
      errorDetails.includes(TRANSFER_TIMEOUT_ERROR2)
    ) {
      toast.error(
        `Transaction timed out, ${getChainDisplayName(multiProvider, origin)} may be busy. Please try again.`,
      );
    } else {
      toast.error(errorMessages[transferStatus] || 'Unable to transfer tokens.');
    }
  }

  setIsLoading(false);
  if (onDone) onDone();
}

const errorMessages: Partial<Record<TransferStatus, string>> = {
  [TransferStatus.Preparing]: 'Error while preparing the transactions.',
  [TransferStatus.CreatingTxs]: 'Error while creating the transactions.',
  [TransferStatus.SigningApprove]: 'Error while signing the approve transaction.',
  [TransferStatus.ConfirmingApprove]: 'Error while confirming the approve transaction.',
  [TransferStatus.SigningTransfer]: 'Error while signing the transfer transaction.',
  [TransferStatus.ConfirmingTransfer]: 'Error while confirming the transfer transaction.',
};

const txCategoryToStatuses: Record<WarpTxCategory, [TransferStatus, TransferStatus]> = {
  [WarpTxCategory.Approval]: [TransferStatus.SigningApprove, TransferStatus.ConfirmingApprove],
  [WarpTxCategory.Revoke]: [TransferStatus.SigningRevoke, TransferStatus.ConfirmingRevoke],
  [WarpTxCategory.Transfer]: [TransferStatus.SigningTransfer, TransferStatus.ConfirmingTransfer],
};
