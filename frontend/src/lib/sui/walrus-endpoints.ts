export interface WalrusEndpointConfig {
  publisherUrl: string;
  aggregatorUrl: string;
  epochs: number;
}

const TESTNET: WalrusEndpointConfig = {
  publisherUrl: "https://publisher.walrus-testnet.walrus.space",
  aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
  epochs: 3,
};

const MAINNET: WalrusEndpointConfig = {
  publisherUrl: "https://publisher.walrus.space",
  aggregatorUrl: "https://aggregator.walrus.space",
  epochs: 3,
};

export function walrusEndpointsForNetwork(
  network: "mainnet" | "testnet" | "devnet",
): WalrusEndpointConfig {
  if (network === "mainnet") return MAINNET;
  return TESTNET;
}
