import { IToken, Token, WarpCore } from '@hyperlane-xyz/sdk';
import {
  errorToString,
  fromWei,
  isNullish,
  objKeys,
  ProtocolType,
  toWei,
} from '@hyperlane-xyz/utils';
import { AccountInfo, getAccountAddressAndPubKey } from '@hyperlane-xyz/widgets';
import { config } from '../../../consts/config';
import { logger } from '../../../utils/logger';
import { isMultiCollateralLimitExceeded } from '../../limits/utils';
import { getTokenByIndex } from '../../tokens/hooks';
import {
  getTokensWithSameCollateralAddresses,
  isValidMultiCollateralToken,
} from '../../tokens/utils';
import { TransferFormValues } from '../types';

const insufficientFundsErrMsg = /insufficient.[funds|lamports]/i;
const emptyAccountErrMsg = /AccountNotFound/i;

export async function validateForm(
  warpCore: WarpCore,
  values: TransferFormValues,
  accounts: Record<ProtocolType, AccountInfo>,
  routerAddressesByChainMap: Record<ChainName, Set<string>>,
): Promise<[Record<string, string> | null, Token | null]> {
  // returns a tuple, where first value is validation result
  // and second value is token override
  try {
    const { origin, destination, tokenIndex, amount, recipient } = values;
    const token = getTokenByIndex(warpCore, tokenIndex);
    if (!token) return [{ token: 'Token is required' }, null];
    const destinationToken = token.getConnectionForChain(destination)?.token;
    if (!destinationToken) return [{ token: 'Token is required' }, null];

    if (
      objKeys(routerAddressesByChainMap).includes(destination) &&
      routerAddressesByChainMap[destination].has(recipient)
    ) {
      return [{ recipient: 'Warp Route address is not valid as recipient' }, null];
    }

    // Check if origin is pruvtest and token symbol is USDC
    if (config.enablePruvOriginFeeUSDC && origin === 'pruvtest' && token.symbol === 'USDC') {
      const inputAmount = parseFloat(amount);
      // For USDC, input must be gt fee because the contract will deduct the fee from user input amount
      const minimumAmount = config.pruvOriginFeeUSDC[destination] || 0;
      if (minimumAmount > 0 && inputAmount <= minimumAmount) {
        return [{ amount: `Amount must be greater than ${minimumAmount}` }, null];
      }
    }

    const transferToken = await getTransferToken(warpCore, token, destinationToken);
    const amountWei = toWei(amount, transferToken.decimals);
    const multiCollateralLimit = isMultiCollateralLimitExceeded(token, destination, amountWei);

    if (multiCollateralLimit) {
      return [
        {
          amount: `Transfer limit is ${fromWei(multiCollateralLimit.toString(), token.decimals)} ${token.symbol}`,
        },
        null,
      ];
    }

    const { address, publicKey: senderPubKey } = getAccountAddressAndPubKey(
      warpCore.multiProvider,
      origin,
      accounts,
    );

    const result = await warpCore.validateTransfer({
      originTokenAmount: transferToken.amount(amountWei),
      destination,
      recipient,
      sender: address || '',
      senderPubKey: await senderPubKey,
    });

    if (!isNullish(result)) return [result, null];

    if (transferToken.addressOrDenom === token.addressOrDenom) return [null, null];

    return [null, transferToken];
  } catch (error: any) {
    logger.error('Error validating form', error);
    let errorMsg = errorToString(error, 40);
    const fullError = `${errorMsg} ${error.message}`;
    if (insufficientFundsErrMsg.test(fullError) || emptyAccountErrMsg.test(fullError)) {
      errorMsg = 'Insufficient funds for gas fees';
    }
    return [{ form: errorMsg }, null];
  }
}

// Checks if a token is a multi-collateral token and if so
// look for other tokens that are the same and returns
// the one with the highest collateral in the destination
export async function getTransferToken(
  warpCore: WarpCore,
  originToken: Token,
  destinationToken: IToken,
) {
  if (!isValidMultiCollateralToken(originToken, destinationToken)) return originToken;

  const tokensWithSameCollateralAddresses = getTokensWithSameCollateralAddresses(
    warpCore,
    originToken,
    destinationToken,
  );

  // if only one token exists then just return that one
  if (tokensWithSameCollateralAddresses.length <= 1) return originToken;

  logger.debug(
    'Multiple multi-collateral tokens found for same collateral address, retrieving balances...',
  );
  const tokenBalances: Array<{ token: Token; balance: bigint }> = [];

  // fetch each destination token balance
  const balanceResults = await Promise.allSettled(
    tokensWithSameCollateralAddresses.map(async ({ originToken, destinationToken }) => {
      try {
        const balance = await warpCore.getTokenCollateral(destinationToken);
        return { token: originToken, balance };
      } catch {
        return null;
      }
    }),
  );

  for (const result of balanceResults) {
    if (result.status === 'fulfilled' && result.value) {
      tokenBalances.push(result.value);
    }
  }

  if (!tokenBalances.length) return originToken;

  // sort by balance to return the highest one
  tokenBalances.sort((a, b) => {
    if (a.balance > b.balance) return -1;
    else if (a.balance < b.balance) return 1;
    else return 0;
  });

  logger.debug('Found route with higher collateral in destination, switching route...');
  return tokenBalances[0].token;
}
