import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import App from "./App";
import "./index.css";

const appId = import.meta.env.VITE_PRIVY_APP_ID as string;
const walletConnectProjectId = import.meta.env
  .VITE_WALLET_CONNECT_PROJECT_ID as string;

const somniaChainId = Number(import.meta.env.VITE_ALLOWED_CHAIN_ID || 5031);
const somniaChainName =
  (import.meta.env.VITE_ALLOWED_CHAIN_NAME as string) || "Somnia Mainnet";
const somniaRpcUrl =
  (import.meta.env.VITE_ALLOWED_RPC_URL as string) ||
  "https://api.infra.mainnet.somnia.network/";
const somniaExplorerUrl =
  (import.meta.env.VITE_ALLOWED_EXPLORER_URL as string) ||
  "https://explorer.somnia.network";

const somniaChain = {
  id: somniaChainId,
  name: somniaChainName,
  nativeCurrency: {
    name: "SOMI",
    symbol: "SOMI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [somniaRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Somnia Explorer",
      url: somniaExplorerUrl,
    },
  },
} as const;

const privyConfig: PrivyClientConfig = {
  appearance: {
    theme: "dark",
    accentColor: "#ffc647",
    showWalletLoginFirst: true,
    walletChainType: "ethereum-only",
  },
  loginMethods: ["wallet", "email", "google"],
  supportedChains: [somniaChain],
  defaultChain: somniaChain,
  walletConnectCloudProjectId: walletConnectProjectId || undefined,
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <PrivyProvider appId={appId} config={privyConfig}>
    <App />
  </PrivyProvider>
);
