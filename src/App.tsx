import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePrivy,
  useWallets,
  useLoginWithEmail,
  useLoginWithOAuth,
  useCreateWallet,
} from "@privy-io/react-auth";

export default function App() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [switchError, setSwitchError] = useState<string>("");
  const [switching, setSwitching] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [signing, setSigning] = useState(false);
  const [flowStatus, setFlowStatus] = useState<string>("");
  const [signature, setSignature] = useState<string>("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState<"email" | "code">("email");
  const switchInFlightRef = useRef(false);
  const autoCreateWalletRef = useRef(false);
  const createWalletRetryRef = useRef(false);

  const chainId = Number(import.meta.env.VITE_ALLOWED_CHAIN_ID || 5031);
  const chainName =
    (import.meta.env.VITE_ALLOWED_CHAIN_NAME as string) || "Somnia Mainnet";
  const activeWallet = wallets[0];
  const { createWallet } = useCreateWallet();
  const [creatingWallet, setCreatingWallet] = useState(false);
  const primaryWalletAddress = useMemo(() => {
    const linked = Array.isArray((user as any)?.linkedAccounts)
      ? (user as any).linkedAccounts
      : [];
    const linkedWallet = linked.find((a: any) => a?.type === "wallet" && a?.address);
    return (
      activeWallet?.address ||
      linkedWallet?.address ||
      user?.wallet?.address ||
      ((user as any)?.embeddedWallets?.[0]?.address as string | undefined) ||
      ((user as any)?.wallets?.[0]?.address as string | undefined) ||
      ""
    );
  }, [activeWallet?.address, user]);
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({
    onComplete: () => setFlowStatus("Google login complete."),
    onError: (err: any) => {
      setSwitchError(err?.message || "Google login failed.");
    },
  });

  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail({
    onComplete: () => {
      setFlowStatus("OTP login complete.");
      setOtpStep("email");
      setOtpCode("");
    },
    onError: (err: any) => {
      setSwitchError(err?.message || "Email OTP login failed.");
    },
  });

  const switchToSomnia = async (): Promise<boolean> => {
    if (switchInFlightRef.current) return false;
    if (!activeWallet) {
      setSwitchError("No connected wallet found. Please login first.");
      return false;
    }

    try {
      switchInFlightRef.current = true;
      setSwitching(true);
      setSwitchError("");
      await activeWallet.switchChain(chainId);
      return true;
    } catch (err: any) {
      const message = String(err?.message || "");
      if (err?.code === -32002 || /already pending/i.test(message)) {
        setSwitchError("Wallet request already pending. Complete it in wallet first.");
      } else {
        setSwitchError(err?.message || "Failed to switch network.");
      }
      return false;
    } finally {
      setSwitching(false);
      switchInFlightRef.current = false;
    }
  };

  const signMessage = async () => {
    if (!activeWallet) {
      setSwitchError("No connected wallet found. Please login first.");
      return;
    }

    try {
      setSigning(true);
      setSwitchError("");
      setFlowStatus("Signing message...");
      const provider =
        (typeof activeWallet.getEthereumProvider === "function"
          ? await activeWallet.getEthereumProvider()
          : null) ||
        (window as Window & { ethereum?: any }).ethereum;

      if (!provider?.request) {
        throw new Error("No wallet provider available for signing.");
      }

      const address = activeWallet.address;
      const message = `LoginWithPrivy verification on ${chainName} (${chainId}) at ${new Date().toISOString()}`;
      const signatureHex = await provider.request({
        method: "personal_sign",
        params: [message, address],
      });
      setSignature(String(signatureHex));
      setFlowStatus("Signed successfully.");
    } catch (err: any) {
      const message = String(err?.message || "");
      if (err?.code === -32002 || /already pending/i.test(message)) {
        setSwitchError("Wallet request already pending. Complete it in wallet first.");
      } else if (err?.code === 4001 || /rejected/i.test(message)) {
        setSwitchError("Signature request was rejected.");
      } else {
        setSwitchError(err?.message || "Failed to sign message.");
      }
    } finally {
      setSigning(false);
    }
  };

  const handleSwitchThenSign = async () => {
    setSignature("");
    setFlowStatus("Switching to Somnia...");
    const switched = await switchToSomnia();
    if (switched) {
      await signMessage();
    }
  };

  const handleLogin = async () => {
    if (loginPending) return;
    try {
      setLoginPending(true);
      await Promise.resolve(login());
    } finally {
      setLoginPending(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwitchError("");
    setFlowStatus("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        setSwitchError("Please enter a valid email.");
        return;
      }
      await sendCode({ email: normalizedEmail });
      setEmail(normalizedEmail);
      setOtpStep("code");
      setFlowStatus("OTP sent. Check your email.");
    } catch (err: any) {
      setSwitchError(err?.message || "Failed to send OTP. Please try again.");
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwitchError("");
    setFlowStatus("");
    try {
      const normalizedCode = otpCode.trim();
      if (!/^[0-9]{6}$/.test(normalizedCode)) {
        setSwitchError("Enter a valid 6-digit OTP code.");
        return;
      }
      await loginWithCode({ code: normalizedCode });
    } catch (err: any) {
      const message = String(err?.message || "");
      if (/invalid email and code combination/i.test(message) || err?.status === 422) {
        setSwitchError("Invalid or expired OTP. Please request a new code and try again.");
        return;
      }
      setSwitchError(err?.message || "OTP verification failed.");
    }
  };

  useEffect(() => {
    if (!ready || !authenticated) {
      autoCreateWalletRef.current = false;
      createWalletRetryRef.current = false;
      return;
    }
    const hasWallet =
      Boolean(primaryWalletAddress);

    if (hasWallet || autoCreateWalletRef.current) return;

    autoCreateWalletRef.current = true;
    void (async () => {
      try {
        setCreatingWallet(true);
        setFlowStatus("Creating wallet for your account...");
        setSwitchError("");
        await createWallet();
        setFlowStatus("Wallet created successfully.");
      } catch (err: any) {
        setSwitchError(err?.message || "Failed to create wallet.");
        autoCreateWalletRef.current = false;
      } finally {
        setCreatingWallet(false);
      }
    })();
  }, [ready, authenticated, primaryWalletAddress, createWallet]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (primaryWalletAddress) return;
    if (creatingWallet || createWalletRetryRef.current) return;

    createWalletRetryRef.current = true;
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          setFlowStatus("Retrying wallet creation...");
          await createWallet();
        } catch {
          // keep prior error messaging from primary flow
        }
      })();
    }, 1800);
    return () => window.clearTimeout(id);
  }, [ready, authenticated, primaryWalletAddress, creatingWallet, createWallet]);

  useEffect(() => {
    if (!authenticated) {
      setFlowStatus("");
      setSignature("");
    }
  }, [authenticated]);

  return (
    <main className="app">
      <div className="card">
        <h1>Login With Privy</h1>
        <p className="muted">Frontend-only starter inside `loginWithPrivy`.</p>

        {!ready && <p>Loading Privy...</p>}

        {ready && !authenticated && (
          <>
            <button className="btn primary" onClick={handleLogin} disabled={loginPending}>
              {loginPending ? "Opening wallet..." : "Connect / Login"}
            </button>
            <button
              className="btn secondary"
              onClick={() => initOAuth({ provider: "google" })}
              disabled={oauthLoading}
            >
              {oauthLoading ? "Opening Google..." : "Continue with Google"}
            </button>
            {otpStep === "email" ? (
              <form className="otp-form" onSubmit={handleSendOtp}>
                <input
                  className="input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button
                  className="btn secondary"
                  type="submit"
                  disabled={emailState.status === "sending-code"}
                >
                  {emailState.status === "sending-code" ? "Sending..." : "Login with OTP"}
                </button>
              </form>
            ) : (
              <form className="otp-form" onSubmit={handleVerifyOtp}>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  placeholder="Enter 6-digit OTP"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                />
                <button
                  className="btn secondary"
                  type="submit"
                  disabled={emailState.status === "submitting-code"}
                >
                  {emailState.status === "submitting-code" ? "Verifying..." : "Verify OTP"}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    setOtpStep("email");
                    setOtpCode("");
                  }}
                >
                  Edit Email
                </button>
              </form>
            )}
          </>
        )}

        {ready && authenticated && (
          <>
            <p>
              Logged in as:{" "}
              <strong>
                {primaryWalletAddress || user?.email?.address || user?.id}
              </strong>
            </p>
            <p className="muted">
              Target chain: {chainName} ({chainId})
            </p>
            <button
              className="btn primary"
              onClick={handleSwitchThenSign}
              disabled={switching || signing || creatingWallet}
            >
              {switching ? "Switching..." : signing ? "Signing..." : "Switch Chain & Sign"}
            </button>
            {flowStatus && <p className="muted">{flowStatus}</p>}
            {switchError && <p className="error">{switchError}</p>}
            {signature && (
              <p className="muted">
                Signature: <strong>{signature.slice(0, 18)}...{signature.slice(-10)}</strong>
              </p>
            )}
            <button className="btn danger" onClick={logout}>
              Logout
            </button>
          </>
        )}
      </div>
    </main>
  );
}
