import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import "./index.css";

const appId = import.meta.env.VITE_PRIVY_APP_ID as string;
const walletConnectProjectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID as string;

const zgChainId   = Number(import.meta.env.VITE_ALLOWED_CHAIN_ID    || 16661);
const zgChainName = (import.meta.env.VITE_ALLOWED_CHAIN_NAME as string) || "0G Mainnet";
const zgRpcUrl    = (import.meta.env.VITE_ALLOWED_RPC_URL    as string) || "https://evmrpc.0g.ai";
const zgExplorerUrl = (import.meta.env.VITE_ALLOWED_EXPLORER_URL as string) || "https://chainscan.0g.ai/";

const zgChain = {
  id: zgChainId,
  name: zgChainName,
  nativeCurrency: {
    name: "0G Token",
    symbol: "A0GI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [zgRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "0G Explorer",
      url: zgExplorerUrl,
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
  supportedChains: [zgChain],
  defaultChain: zgChain,
  walletConnectCloudProjectId: walletConnectProjectId || undefined,
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <PrivyProvider appId={appId} config={privyConfig}>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </PrivyProvider>
  </BrowserRouter>
);
