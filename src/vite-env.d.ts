/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_WALLET_CONNECT_PROJECT_ID?: string;
  readonly VITE_ALLOWED_CHAIN_ID?: string;
  readonly VITE_ALLOWED_CHAIN_NAME?: string;
  readonly VITE_ALLOWED_RPC_URL?: string;
  readonly VITE_ALLOWED_EXPLORER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
