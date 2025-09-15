import { TokenSelectField } from '../../tokens/TokenSelectField';

export default function TokenSection({
  setIsNft,
  isReview,
}: {
  setIsNft: (b: boolean) => void;
  isReview: boolean;
}) {
  return (
    <div className="flex-1">
      <label htmlFor="tokenIndex" className="block pl-0.5 text-sm text-gray-600">
        Token
      </label>
      <TokenSelectField name="tokenIndex" disabled={isReview} setIsNft={setIsNft} />
    </div>
  );
}
