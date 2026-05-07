import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import * as api from "../api/zerog";

// ── Types ─────────────────────────────────────────────────────────────────────

type LogLevel = "info" | "success" | "error" | "warn";
interface LogEntry {
  time: string;
  level: LogLevel;
  msg: string;
}

type StageStatus = "idle" | "running" | "done" | "failed";
interface Pipeline {
  storage: StageStatus;
  chain: StageStatus;
  da: StageStatus;
  compute: StageStatus;
  rootHash?: string;
  txHash?: string;
  saveIndex?: number;
  checksum?: string;
  fileSize?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function short(s: string, n = 10) {
  if (!s) return "—";
  return s.length > n * 2 + 3 ? `${s.slice(0, n)}...${s.slice(-6)}` : s;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const STAGE_LABELS: Record<string, string> = {
  storage: "0G Storage",
  chain: "Chain Anchor",
  da: "DA Finality",
  compute: "TEE Compute",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();
  const navigate = useNavigate();

  const activeWallet = wallets[0];
  const walletAddress = useMemo(() => {
    const linked = Array.isArray((user as any)?.linkedAccounts) ? (user as any).linkedAccounts : [];
    const lw = linked.find((a: any) => a?.type === "wallet" && a?.address);
    return (
      activeWallet?.address ||
      lw?.address ||
      user?.wallet?.address ||
      (user as any)?.embeddedWallets?.[0]?.address ||
      ""
    );
  }, [activeWallet?.address, user]);

  // State
  const [jwt, setJwt] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline>({
    storage: "idle", chain: "idle", da: "idle", compute: "idle",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dashData, setDashData] = useState<any>(null);
  const [networkData, setNetworkData] = useState<any>(null);
  const [activityData, setActivityData] = useState<any>(null);
  const [loadResult, setLoadResult] = useState<string | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [notification, setNotification] = useState<{ msg: string; type: LogLevel } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (ready && !authenticated) navigate("/");
  }, [ready, authenticated, navigate]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-dismiss notification
  useEffect(() => {
    if (!notification) return;
    const id = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(id);
  }, [notification]);

  function log(level: LogLevel, msg: string) {
    setLogs(prev => [...prev, { time: ts(), level, msg }]);
    if (level === "error") setNotification({ msg, type: "error" });
    if (level === "success") setNotification({ msg, type: "success" });
  }

  function notify(msg: string, type: LogLevel = "info") {
    setNotification({ msg, type });
  }

  // ── Auth flow ───────────────────────────────────────────────────────────────

  const authenticate = useCallback(async () => {
    if (!walletAddress || !activeWallet) {
      log("error", "No wallet connected.");
      return;
    }
    try {
      setAuthLoading(true);
      log("info", `Requesting nonce for ${short(walletAddress)}`);

      const { message, nonce } = await api.getNonce(walletAddress);
      log("success", "Nonce received from backend.");
      log("info", "Signing message with wallet...");

      const provider =
        typeof activeWallet.getEthereumProvider === "function"
          ? await activeWallet.getEthereumProvider()
          : (window as any).ethereum;

      if (!provider?.request) throw new Error("No wallet provider available.");

      const signature = await provider.request({
        method: "personal_sign",
        params: [message, walletAddress],
      });

      log("info", "Signature obtained. Exchanging for JWT...");
      const { token } = await api.login(walletAddress, signature, nonce);
      setJwt(token);
      log("success", "Authentication complete. JWT valid for 7 days.");
      notify("Authenticated successfully.", "success");
    } catch (err: any) {
      log("error", `Auth failed: ${err.message}`);
    } finally {
      setAuthLoading(false);
    }
  }, [walletAddress, activeWallet]);

  // ── File upload + pipeline ──────────────────────────────────────────────────

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    log("info", `File selected: ${file.name} (${formatBytes(file.size)})`);
  };

  const uploadAndTest = async () => {
    if (!selectedFile || !jwt) return;

    setUploading(true);
    setPipeline({ storage: "running", chain: "idle", da: "idle", compute: "idle" });
    log("info", `Starting pipeline test with: ${selectedFile.name} (${formatBytes(selectedFile.size)})`);

    try {
      // Step 1: upload to 0G Storage
      log("info", "Uploading binary to 0G Storage (mainnet)...");
      const buffer = await selectedFile.arrayBuffer();
      const result = await api.saveBinary(buffer, jwt);

      setPipeline(p => ({
        ...p,
        storage: "done",
        chain: "running",
        rootHash: result.rootHash,
        txHash: result.txHash,
        saveIndex: result.saveIndex,
        checksum: result.checksum,
        fileSize: result.fileSize,
      }));

      log("success", `Stored on 0G Storage. Root hash: ${short(result.rootHash)}`);
      log("info", `Save index: ${result.saveIndex} | Checksum: ${short(result.checksum, 8)}`);
      log("info", "Background pipeline started: Chain anchor + DA + Compute running...");

      notify(`Save #${result.saveIndex} uploaded. Pipeline running in background.`, "success");

      // Step 2: poll metadata until chain and DA complete
      startPolling(walletAddress, result.saveIndex, jwt);

    } catch (err: any) {
      setPipeline(p => ({ ...p, storage: "failed" }));
      log("error", `Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  function startPolling(wallet: string, saveIndex: number, token: string) {
    if (pollRef.current) clearInterval(pollRef.current);

    let attempts = 0;
    const max = 30; // max 150 seconds

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const meta = await api.getMetadata(wallet);
        const save = meta.saves?.find((s: any) => s.saveIndex === saveIndex);
        if (!save) return;

        setPipeline(p => {
          const next = { ...p };

          if (save.anchorTxHash && p.chain !== "done") {
            next.chain = "done";
            log("success", `Chain anchor confirmed. Tx: ${short(save.anchorTxHash)}`);
            notify("Chain anchor confirmed on 0G Mainnet.", "success");
          } else if (p.chain === "running" && attempts > 3) {
            next.chain = "running";
          }

          if (save.daStatus === "finalized" && p.da !== "done") {
            next.da = "done";
            log("success", `DA finalized. Batch: ${save.daCommitment?.batchId ?? "—"}, Blob: ${save.daCommitment?.blobIndex ?? "—"}`);
            notify("BLS-signed DA finality received.", "success");
          } else if (save.daStatus === "failed" && p.da !== "failed") {
            next.da = "failed";
            log("warn", "DA finalization failed (timeout). Save is still valid.");
          } else if (p.da === "idle" && next.chain === "done") {
            next.da = "running";
          }

          if (save.computeValidation?.verdict && p.compute !== "done" && p.compute !== "failed") {
            next.compute = save.computeValidation.valid ? "done" : "failed";
            log("success", `TEE Compute verdict: ${save.computeValidation.verdict} (confidence ${((save.computeValidation.confidence || 0) * 100).toFixed(0)}%)`);
          } else if (save.computeSkipped && p.compute === "idle") {
            next.compute = "done"; // skipped = not suspicious, no flags
            log("info", "Compute: skipped (delta below threshold — normal save).");
          }

          return next;
        });

        // Stop polling once all meaningful stages are resolved
        const updated = await api.getMetadata(wallet).then(m => m.saves?.find((s: any) => s.saveIndex === saveIndex));
        const done = (updated?.anchorTxHash || attempts > 10) &&
          (updated?.daStatus !== "pending" || attempts > 25) &&
          (updated?.computeValidation || updated?.computeSkipped || attempts > 20);

        if (done || attempts >= max) {
          if (pollRef.current) clearInterval(pollRef.current);
          log("info", "Pipeline monitoring complete.");
          // Refresh dashboard data
          fetchDashboard(token);
        }
      } catch (err: any) {
        log("warn", `Poll error: ${err.message}`);
      }
    }, 5000);
  }

  // ── Load latest save ────────────────────────────────────────────────────────

  const testLoad = async () => {
    if (!jwt) return;
    try {
      log("info", "Fetching latest save from 0G Storage...");
      const { buffer, rootHash, saveIndex, daStatus, checksum } = await api.loadBinary(jwt);
      const size = formatBytes(buffer.byteLength);
      setLoadResult(`${size} received — save #${saveIndex} — DA: ${daStatus} — hash: ${short(rootHash)}`);
      log("success", `Load OK. ${size} | Save #${saveIndex} | DA: ${daStatus} | Checksum: ${short(checksum, 8)}`);
      notify(`Loaded save #${saveIndex} from 0G Storage.`, "success");
    } catch (err: any) {
      log("error", `Load failed: ${err.message}`);
    }
  };

  // ── Fetch dashboard data ────────────────────────────────────────────────────

  const fetchDashboard = async (token: string) => {
    setLoadingDash(true);
    log("info", "Fetching dashboard data...");
    try {
      const [dash, net, act] = await Promise.all([
        api.getDashboard(token),
        api.getNetworkStatus(),
        api.getActivity(token),
      ]);
      setDashData(dash);
      setNetworkData(net);
      setActivityData(act);
      log("success", "Dashboard data loaded.");
    } catch (err: any) {
      log("warn", `Dashboard fetch partial failure: ${err.message}`);
    } finally {
      setLoadingDash(false);
    }
  };

  useEffect(() => {
    if (jwt) fetchDashboard(jwt);
  }, [jwt]);

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!ready || !authenticated) return <div className="app"><p>Loading...</p></div>;

  return (
    <div className="dash-root">
      {/* Notification toast */}
      {notification && (
        <div className={`toast toast-${notification.type}`}>
          {notification.msg}
        </div>
      )}

      {/* Header */}
      <header className="dash-header">
        <div className="dash-header-left">
          <span className="dash-logo">0G ZeroDash</span>
          <span className="dash-tag">Testing Dashboard</span>
        </div>
        <div className="dash-header-right">
          <span className="wallet-chip">{short(walletAddress, 8)}</span>
          <span className={`status-pill ${jwt ? "pill-ok" : "pill-warn"}`}>
            {jwt ? "Authenticated" : "No JWT"}
          </span>
          <button className="btn danger sm" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="dash-body">
        {/* Left column */}
        <div className="dash-left">

          {/* Auth card */}
          <section className="dash-card">
            <h2 className="card-title">Backend Authentication</h2>
            <p className="card-sub">
              Signs a nonce with your wallet to get a JWT. Required for save/load and dashboard endpoints.
            </p>
            <div className="auth-row">
              <div className="auth-info">
                <span className="field-label">Wallet</span>
                <span className="mono">{walletAddress || "—"}</span>
              </div>
              <div className="auth-info">
                <span className="field-label">JWT Status</span>
                <span className={jwt ? "text-ok" : "text-warn"}>
                  {jwt ? "Active — expires in 7 days" : "Not authenticated"}
                </span>
              </div>
            </div>
            {!jwt ? (
              <button className="btn primary" onClick={authenticate} disabled={authLoading || !walletAddress}>
                {authLoading ? "Authenticating..." : "Authenticate (Get JWT)"}
              </button>
            ) : (
              <button className="btn secondary sm" onClick={authenticate}>Re-authenticate</button>
            )}
          </section>

          {/* Upload test card */}
          <section className="dash-card">
            <h2 className="card-title">Save Pipeline Test</h2>
            <p className="card-sub">
              Upload a binary file. The backend stores it on 0G Storage, anchors the root hash on-chain,
              publishes to 0G DA, and optionally runs TEE anti-cheat.
            </p>

            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""} ${selectedFile ? "has-file" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFileSelect(f);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                style={{ display: "none" }}
                onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
              />
              {selectedFile ? (
                <div>
                  <div className="drop-file-name">{selectedFile.name}</div>
                  <div className="drop-file-size">{formatBytes(selectedFile.size)}</div>
                </div>
              ) : (
                <div className="drop-placeholder">
                  Click to select a binary file or drag it here
                </div>
              )}
            </div>

            <button
              className="btn primary"
              onClick={uploadAndTest}
              disabled={!selectedFile || !jwt || uploading}
            >
              {uploading ? "Uploading..." : "Upload & Run Pipeline"}
            </button>
            {!jwt && <p className="field-label" style={{ marginTop: 8 }}>Authenticate first to enable upload.</p>}

            {/* Pipeline stages */}
            <div className="pipeline-row">
              {(["storage", "chain", "da", "compute"] as const).map(stage => (
                <div key={stage} className={`pipeline-stage stage-${pipeline[stage]}`}>
                  <div className="stage-indicator" />
                  <div className="stage-label">{STAGE_LABELS[stage]}</div>
                  <div className="stage-status">{pipeline[stage]}</div>
                </div>
              ))}
            </div>

            {/* Pipeline result details */}
            {pipeline.rootHash && (
              <div className="result-block">
                <div className="result-row"><span>Root Hash</span><span className="mono">{short(pipeline.rootHash, 14)}</span></div>
                {pipeline.txHash  && <div className="result-row"><span>Storage Tx</span><span className="mono">{short(pipeline.txHash, 14)}</span></div>}
                {pipeline.saveIndex !== undefined && <div className="result-row"><span>Save Index</span><span className="mono">{pipeline.saveIndex}</span></div>}
                {pipeline.fileSize && <div className="result-row"><span>File Size</span><span className="mono">{formatBytes(pipeline.fileSize)}</span></div>}
                {pipeline.checksum && <div className="result-row"><span>SHA-256</span><span className="mono">{short(pipeline.checksum, 12)}</span></div>}
              </div>
            )}
          </section>

          {/* Load test card */}
          <section className="dash-card">
            <h2 className="card-title">Load Test</h2>
            <p className="card-sub">Download your latest save from 0G Storage and verify the content.</p>
            <button className="btn secondary" onClick={testLoad} disabled={!jwt}>
              Fetch Latest Save
            </button>
            {loadResult && <div className="result-block" style={{ marginTop: 12 }}><div className="mono text-ok">{loadResult}</div></div>}
          </section>

          {/* Log panel */}
          <section className="dash-card">
            <div className="log-header">
              <h2 className="card-title">Log Output</h2>
              <button className="btn ghost sm" onClick={() => setLogs([])}>Clear</button>
            </div>
            <div className="log-panel">
              {logs.length === 0 && <div className="log-empty">No log entries yet.</div>}
              {logs.map((e, i) => (
                <div key={i} className={`log-entry log-${e.level}`}>
                  <span className="log-time">[{e.time}]</span>
                  <span className="log-level">[{e.level.toUpperCase().padEnd(7)}]</span>
                  <span className="log-msg">{e.msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="dash-right">

          {/* Network status */}
          <section className="dash-card">
            <div className="card-title-row">
              <h2 className="card-title">Network Status</h2>
              <button className="btn ghost sm" onClick={() => api.getNetworkStatus().then(setNetworkData)}>Refresh</button>
            </div>
            {networkData ? (
              <div>
                <div className="net-overall">
                  Overall: <span className={networkData.overall === "healthy" ? "text-ok" : "text-warn"}>{networkData.overall}</span>
                </div>
                <table className="net-table">
                  <tbody>
                    {Object.entries(networkData.services || {}).map(([key, svc]: [string, any]) => (
                      <tr key={key}>
                        <td className="net-name">{svc.label || key}</td>
                        <td>
                          <span className={`net-status-badge ${svc.status === "online" ? "ns-ok" : svc.status === "configured" ? "ns-cfg" : "ns-err"}`}>
                            {svc.status}
                          </span>
                        </td>
                        <td className="net-latency">{svc.latencyMs ? `${svc.latencyMs}ms` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="card-sub">{jwt ? "Authenticate first, then load network status." : "Network status will load after authentication."}</p>
            )}
          </section>

          {/* Trust score / stats */}
          {dashData && (
            <section className="dash-card">
              <h2 className="card-title">Trust Score</h2>
              <div className="trust-score-row">
                <span className="trust-score-num">{dashData.trustScore?.score ?? "—"}</span>
                <span className={`trust-badge trust-${(dashData.trustScore?.label || "").toLowerCase()}`}>
                  {dashData.trustScore?.label || "—"}
                </span>
              </div>
              <p className="card-sub" style={{ marginTop: 6 }}>{dashData.trustScore?.description}</p>

              <div className="stat-grid">
                <div className="stat-item">
                  <div className="stat-value">{dashData.summary?.totalSaves ?? 0}</div>
                  <div className="stat-label">Total Saves</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{dashData.summary?.finalizedSaves ?? 0}</div>
                  <div className="stat-label">DA Finalized</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{dashData.summary?.anchoredSaves ?? 0}</div>
                  <div className="stat-label">Anchored</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{dashData.summary?.totalDataStored ?? "0 B"}</div>
                  <div className="stat-label">Data Stored</div>
                </div>
              </div>

              {dashData.latestSave && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-label">Latest Save — Index #{dashData.latestSave.saveIndex}</div>
                  <div className="result-row"><span>Root Hash</span><span className="mono">{short(dashData.latestSave.rootHash, 12)}</span></div>
                  <div className="result-row"><span>Coins</span><span>{dashData.latestSave.coinSnapshot}</span></div>
                  <div className="result-row"><span>Size</span><span>{dashData.latestSave.fileSize}</span></div>
                  <div className="pipeline-mini">
                    {Object.entries(dashData.latestSave.pipeline || {}).map(([k, v]: [string, any]) => (
                      <div key={k} className={`mini-stage ${v.done ? "mini-done" : "mini-pending"}`}>
                        <div className="mini-dot" />
                        <span>{STAGE_LABELS[k] || k}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {loadingDash && <p className="card-sub" style={{ marginTop: 8 }}>Refreshing...</p>}
              <button className="btn secondary sm" onClick={() => jwt && fetchDashboard(jwt)} disabled={!jwt || loadingDash} style={{ marginTop: 10 }}>
                Refresh Stats
              </button>
            </section>
          )}

          {/* Activity feed */}
          {activityData?.events?.length > 0 && (
            <section className="dash-card">
              <h2 className="card-title">Activity Feed</h2>
              <div className="activity-list">
                {activityData.events.slice(0, 10).map((ev: any) => (
                  <div key={ev.id} className="activity-item">
                    <div className="activity-top">
                      <span className={`act-type act-${ev.status}`}>{ev.type}</span>
                      <span className="activity-time">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="activity-title">{ev.title}</div>
                    {ev.explorerUrl && (
                      <a href={ev.explorerUrl} target="_blank" rel="noopener noreferrer" className="act-link">
                        View on explorer
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Raw metadata inspector */}
          {jwt && (
            <section className="dash-card">
              <div className="card-title-row">
                <h2 className="card-title">Metadata Inspector</h2>
                <button
                  className="btn ghost sm"
                  onClick={() => api.getMetadata(walletAddress).then(d => log("info", JSON.stringify(d.onChain, null, 2)))}
                >
                  Fetch On-chain
                </button>
              </div>
              <p className="card-sub">Click to query the on-chain anchor state for your wallet and print it to the log.</p>
              <button
                className="btn secondary sm"
                onClick={() => api.verify(walletAddress).then(d => {
                  log("info", `Integrity check — DB: ${d.layers.dbRecord} | DA: ${d.layers.daFinalized} | Checksum: ${d.layers.checksumMatch} | Compute: ${d.layers.computeValidated}`);
                  log(d.allPassed ? "success" : "warn", d.allPassed ? "All layers passed." : "Some layers failed — check log above.");
                })}
              >
                Run Integrity Check
              </button>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
