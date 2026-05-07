import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const [switchError, setSwitchError] = useState<string>("");
  const [loginPending, setLoginPending] = useState(false);
  const [flowStatus, setFlowStatus] = useState<string>("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState<"email" | "code">("email");
  const autoCreateWalletRef = useRef(false);
  const createWalletRetryRef = useRef(false);

  const chainId   = Number(import.meta.env.VITE_ALLOWED_CHAIN_ID    || 16661);
  const chainName = (import.meta.env.VITE_ALLOWED_CHAIN_NAME as string) || "0G Mainnet";
  const activeWallet = wallets[0];
  const { createWallet } = useCreateWallet();
  const [creatingWallet, setCreatingWallet] = useState(false);

  const primaryWalletAddress = useMemo(() => {
    const linked = Array.isArray((user as any)?.linkedAccounts) ? (user as any).linkedAccounts : [];
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
    onError: (err: any) => setSwitchError(err?.message || "Google login failed."),
  });

  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail({
    onComplete: () => {
      setFlowStatus("OTP login complete.");
      setOtpStep("email");
      setOtpCode("");
    },
    onError: (err: any) => setSwitchError(err?.message || "Email OTP login failed."),
  });

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
      if (!normalizedEmail) { setSwitchError("Please enter a valid email."); return; }
      await sendCode({ email: normalizedEmail });
      setEmail(normalizedEmail);
      setOtpStep("code");
      setFlowStatus("OTP sent. Check your email.");
    } catch (err: any) {
      setSwitchError(err?.message || "Failed to send OTP.");
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwitchError("");
    setFlowStatus("");
    try {
      const normalizedCode = otpCode.trim();
      if (!/^[0-9]{6}$/.test(normalizedCode)) { setSwitchError("Enter a valid 6-digit OTP code."); return; }
      await loginWithCode({ code: normalizedCode });
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (/invalid email and code combination/i.test(msg) || err?.status === 422) {
        setSwitchError("Invalid or expired OTP. Request a new code and try again.");
        return;
      }
      setSwitchError(err?.message || "OTP verification failed.");
    }
  };

  // Auto-create wallet for non-wallet login methods
  useEffect(() => {
    if (!ready || !authenticated) {
      autoCreateWalletRef.current = false;
      createWalletRetryRef.current = false;
      return;
    }
    if (Boolean(primaryWalletAddress) || autoCreateWalletRef.current) return;
    autoCreateWalletRef.current = true;
    void (async () => {
      try {
        setCreatingWallet(true);
        setFlowStatus("Creating wallet for your account...");
        await createWallet();
        setFlowStatus("Wallet ready.");
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
      void (async () => { try { await createWallet(); } catch {} })();
    }, 1800);
    return () => window.clearTimeout(id);
  }, [ready, authenticated, primaryWalletAddress, creatingWallet, createWallet]);

  // Redirect to dashboard once authenticated and wallet is ready
  useEffect(() => {
    if (ready && authenticated && primaryWalletAddress && !creatingWallet) {
      navigate("/dashboard");
    }
  }, [ready, authenticated, primaryWalletAddress, creatingWallet, navigate]);

  useEffect(() => {
    if (!authenticated) { setFlowStatus(""); }
  }, [authenticated]);

  return (
    <main className="app">
      <div className="card">
        <h1>0G ZeroDash</h1>
        <p className="muted">Connect your wallet to access the 0G dashboard.</p>
        <p className="muted" style={{ fontSize: "12px" }}>
          Network: {chainName} — Chain ID {chainId}
        </p>

        {!ready && <p>Loading...</p>}

        {ready && !authenticated && (
          <>
            <button className="btn primary" onClick={handleLogin} disabled={loginPending}>
              {loginPending ? "Opening wallet..." : "Connect Wallet"}
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
                <button className="btn secondary" type="submit" disabled={emailState.status === "sending-code"}>
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
                <button className="btn secondary" type="submit" disabled={emailState.status === "submitting-code"}>
                  {emailState.status === "submitting-code" ? "Verifying..." : "Verify OTP"}
                </button>
                <button className="btn ghost" type="button" onClick={() => { setOtpStep("email"); setOtpCode(""); }}>
                  Back
                </button>
              </form>
            )}
          </>
        )}

        {ready && authenticated && (
          <div style={{ marginTop: 16 }}>
            {creatingWallet ? (
              <p className="muted">Setting up wallet...</p>
            ) : (
              <p className="muted">Redirecting to dashboard...</p>
            )}
            {flowStatus && <p className="muted">{flowStatus}</p>}
            {switchError && <p className="error">{switchError}</p>}
            <button className="btn danger" onClick={logout} style={{ marginTop: 12 }}>
              Logout
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
