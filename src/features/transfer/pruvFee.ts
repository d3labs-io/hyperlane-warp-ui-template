import BigNumber from 'bignumber.js';
import { config } from '../../consts/config';

export function getPruvOriginFeeUSDC(destination: string): number {
  return config.pruvOriginFeeUSDC[destination] ?? 0;
}

export function shouldApplyPruvUsdcBonus({
  origin,
  destination,
  tokenSymbol,
}: {
  origin: string;
  destination: string;
  tokenSymbol?: string;
}): boolean {
  return (
    config.enablePruvOriginFeeUSDC &&
    origin.startsWith('pruv') &&
    !destination.startsWith('pruv') &&
    tokenSymbol === 'USDC' &&
    getPruvOriginFeeUSDC(destination) > 0
  );
}

export function getAmountWithPruvUsdcBonus({
  amount,
  origin,
  destination,
  tokenSymbol,
}: {
  amount: string;
  origin: string;
  destination: string;
  tokenSymbol?: string;
}): string {
  if (!shouldApplyPruvUsdcBonus({ origin, destination, tokenSymbol })) return amount;
  const fee = getPruvOriginFeeUSDC(destination);
  if (!fee) return amount;

  const value = new BigNumber(amount || 0);
  if (!value.isFinite()) return amount;

  return value.plus(fee).toString();
}
