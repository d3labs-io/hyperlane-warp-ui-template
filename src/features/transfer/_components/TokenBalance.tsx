import { TokenAmount } from '@hyperlane-xyz/sdk';

export default function TokenBalance({
  label,
  balance,
}: {
  label: string;
  balance?: TokenAmount | null;
}) {
  const value = balance?.getDecimalFormattedAmount().toFixed(5) || '0';
  return <div className="text-right text-xs text-gray-600">{`${label}: ${value}`}</div>;
}
