import {
  EvmTokenAdapter,
  ProviderType,
  TypedTransactionReceipt,
  WarpCore,
  WarpTxCategory,
} from '@hyperlane-xyz/sdk';
import { ProtocolType, toTitleCase, toWei } from '@hyperlane-xyz/utils';
import {
  getAccountAddressForChain,
  useAccounts,
  useActiveChains,
  useTransactionFns,
} from '@hyperlane-xyz/widgets';
import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import { type Config as WagmiConfig, useConfig } from 'wagmi';
import { toastTxSuccess } from '../../components/toast/TxSuccessToast';
import { config } from '../../consts/config';
import { logger } from '../../utils/logger';
import { useMultiProvider } from '../chains/hooks';
import { preEstimateGasForEvmTxs, resilientConfirm } from '../chains/rpcUtils';
import { getChainDisplayName } from '../chains/utils';
import { AppState, useStore } from '../store';
import { getTokenByIndex, useWarpCore } from '../tokens/hooks';
import { TransferContext, TransferFormValues, TransferStatus } from './types';
import { tryGetMsgIdFromTransferReceipt } from './utils';

const CHAIN_MISMATCH_ERROR = 'ChainMismatchError';
const TRANSFER_TIMEOUT_ERROR1 = 'block height exceeded';
const TRANSFER_TIMEOUT_ERROR2 = 'timeout';
const ERROR_TOAST_DURATION_MS = 8000;
const ERROR_TOAST_OPTIONS = {
  autoClose: ERROR_TOAST_DURATION_MS,
  ariaLabel: 'Transfer Failed',
  theme: 'colored',
} as const;

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
  const wagmiConfig = useConfig();

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
        wagmiConfig,
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
      wagmiConfig,
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
  wagmiConfig,
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
  wagmiConfig: WagmiConfig;
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
    const weiAmountOrId = isNft ? amount : toWei(amount, originToken.decimals);
    const originTokenAmount = originToken.amount(weiAmountOrId);

    const sendTransaction = transactionFns[originProtocol].sendTransaction;
    const sendMultiTransaction = transactionFns[originProtocol].sendMultiTransaction;
    const activeChain = activeChains.chains[originProtocol];

    const IS_ORIGIN_DEFAULT =
      config.enablePruvOriginFeeUSDC && origin.startsWith('pruv') && originToken.symbol === 'USDC';

    const IS_NON_ORIGIN_DEFAULT =
      config.enablePruvOriginFeeUSDC && origin.startsWith('pruv') && originToken.symbol !== 'USDC';

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
    /*
     If origin is a pruv chain and the token is USDC (IS_ORIGIN_DEFAULT),
     change the approval amount to (user input amount) + (bridge USDC fee).
     Skip if allowance is already sufficient.
    */
    if (IS_ORIGIN_DEFAULT) {
      const bridgeFee = config.pruvOriginFeeUSDC[destination];
      const totalApprovalAmount = parseFloat(amount) + bridgeFee;
      const approvalAmountWei = toWei(totalApprovalAmount.toString(), originToken.decimals);
      const routerAddress = originToken.addressOrDenom;

      const tokenAdapter = new EvmTokenAdapter(origin, multiProvider, {
        token: originToken.collateralAddressOrDenom || originToken.addressOrDenom,
      });

      const needsApproval = await tokenAdapter.isApproveRequired(
        sender,
        routerAddress,
        approvalAmountWei,
      );
      const approvalIndex = txs.findIndex((tx) => tx.category === WarpTxCategory.Approval);

      if (needsApproval) {
        const approvalTx = await tokenAdapter.populateApproveTx({
          weiAmountOrId: approvalAmountWei,
          recipient: routerAddress,
        });

        if (approvalIndex >= 0) {
          txs[approvalIndex] = {
            ...txs[approvalIndex],
            transaction: approvalTx,
          } as any;
        } else {
          const approvalTxObj = {
            category: WarpTxCategory.Approval,
            type: multiProvider.getProvider(origin).type,
            transaction: approvalTx,
          } as any;
          txs.unshift(approvalTxObj);
        }
      } else if (approvalIndex >= 0) {
        // Remove the SDK-added approval since sufficient allowance exists
        txs.splice(approvalIndex, 1);
      }
    } else if (IS_NON_ORIGIN_DEFAULT) {
      // Add extra USDC approval transaction if origin is pruv and token is not USDC
      const bridgeFeeUSDC = config.pruvOriginFeeUSDC[destination];
      const usdcAmount = bridgeFeeUSDC * Math.pow(10, config.pruvUSDCMetadata.decimals);

      const usdcTokenAdapter = new EvmTokenAdapter(origin, multiProvider, {
        token: config.pruvUSDCMetadata.address,
      });

      // Check if USDC approval is actually needed
      const needsUSDCApproval = await usdcTokenAdapter.isApproveRequired(
        sender,
        originToken.addressOrDenom,
        usdcAmount.toString(),
      );

      if (needsUSDCApproval) {
        const populatedApprovalTx = await usdcTokenAdapter.populateApproveTx({
          weiAmountOrId: usdcAmount.toString(),
          recipient: originToken.addressOrDenom,
        });

        txs.unshift({
          category: WarpTxCategory.Approval,
          type: multiProvider.getProvider(origin).type,
          transaction: populatedApprovalTx,
        } as any);
      }
    }

    const isEvm = originProtocol === ProtocolType.Ethereum;
    const chainId = isEvm ? (multiProvider.getChainMetadata(origin).chainId as number) : 0;

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
        // Estimate gas right before sending each tx via the CORS-resilient
        // public client so wagmi doesn't fall back to the WalletConnect
        // connector's rpcMap (which may be CORS-blocked). Doing this per-tx
        // (rather than upfront for all txs) ensures that when we reach
        // transferRemote, any prior approvals are already confirmed on-chain
        // and the simulation succeeds with the correct allowance state.
        if (isEvm) {
          await preEstimateGasForEvmTxs(wagmiConfig, chainId, sender, [tx as any]);
        }
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
        // Race wallet confirmation against direct RPC polling for EVM chains.
        // WalletConnect behaviour varies across wallets — some fail to resolve
        // the confirm callback even after the tx lands on-chain.
        // Also pass contract address + sender for event-based fallback which
        // handles Safe (Gnosis) wallets that return a safeTxHash instead of
        // an on-chain txHash.
        txReceipt = isEvm
          ? await resilientConfirm(confirm, hash, wagmiConfig, chainId, {
              contractAddress: (tx.transaction as Record<string, any>).to,
              sender,
            })
          : await confirm();
        // Extract the real on-chain txHash from the receipt. This may differ
        // from `hash` when a Safe wallet returns a safeTxHash instead of the
        // actual on-chain hash (detected via event-based polling).
        const confirmedHash = (txReceipt?.receipt as Record<string, any>)?.transactionHash ?? hash;
        const description = toTitleCase(tx.category);
        logger.debug(`${description} transaction confirmed, hash:`, confirmedHash);
        toastTxSuccess(`${description} transaction sent!`, confirmedHash, origin);

        hashes.push(confirmedHash);
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
    const errorDetails = error?.message || error?.toString?.() || '';
    const errorDetailsExtended = [
      errorDetails,
      error?.shortMessage,
      error?.cause?.message,
      error?.cause?.toString?.(),
      (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return '';
        }
      })(),
    ]
      .filter(Boolean)
      .join(' | ')
      .toLowerCase();
    updateTransferStatus(transferIndex, TransferStatus.Failed);
    const isInternalRpcErrorOnApprove =
      transferStatus === TransferStatus.SigningApprove &&
      errorDetailsExtended.includes('transactionexecutionerror') &&
      errorDetailsExtended.includes('internalrpcerror') &&
      errorDetailsExtended.includes('internal error was received');

    if (isInternalRpcErrorOnApprove) {
      toast.error(
        'Network mismatch detected, switch wallet to the origin chain and try again.',
        ERROR_TOAST_OPTIONS,
      );
    } else if (errorDetails.includes(CHAIN_MISMATCH_ERROR)) {
      // Wagmi switchNetwork call `helps prevent this but isn't foolproof
      toast.error('Wallet must be connected to origin chain', ERROR_TOAST_OPTIONS);
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
