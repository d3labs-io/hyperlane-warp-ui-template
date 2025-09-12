import '@hyperlane-xyz/sdk';

declare global {
  type Address = string;
  type ChainName = string;
  type ChainId = number | string;
  type DomainId = number;
  module '*.yaml' {
    const data: any;
    export default data;
  }
}

declare module '@hyperlane-xyz/sdk' {
  interface IToken {
    feeAddressOrDenom: string;
  }
  interface Token {
    feeAddressOrDenom: string;
  }
}
