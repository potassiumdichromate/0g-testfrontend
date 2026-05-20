const BASE = "https://zerog-robowars.onrender.com";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    let err: any = {};
    try { err = await res.json(); } catch {}
    throw new Error(err?.detail || err?.error || err?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function getNonce(wallet: string) {
  return req<{ wallet: string; nonce: string; message: string; issuedAt: string; expiresIn: number }>(
    `/auth/nonce?wallet=${wallet}`
  );
}

export function login(wallet: string, signature: string, nonce: string) {
  return req<{ token: string; wallet: string; expiresIn: number }>(
    "/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, signature, nonce }),
    }
  );
}

// ── Save / Load ───────────────────────────────────────────────────────────────

export async function saveBinary(buffer: ArrayBuffer, jwt: string, saveIndex?: number) {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    Authorization: `Bearer ${jwt}`,
  };
  if (saveIndex !== undefined) headers["X-Save-Index"] = String(saveIndex);

  const res = await fetch(`${BASE}/player/save/binary`, {
    method: "POST",
    headers,
    body: buffer,
  });
  if (!res.ok) {
    let err: any = {};
    try { err = await res.json(); } catch {}
    throw new Error(err?.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    success: boolean;
    rootHash: string;
    saveIndex: number;
    txHash: string;
    checksum: string;
    fileSize: number;
  }>;
}

export async function loadBinary(jwt: string) {
  const res = await fetch(`${BASE}/player/load/binary`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    let err: any = {};
    try { err = await res.json(); } catch {}
    throw new Error(err?.error || `HTTP ${res.status}`);
  }
  const rootHash  = res.headers.get("X-Root-Hash")    || "";
  const saveIndex = res.headers.get("X-Save-Index")   || "";
  const daStatus  = res.headers.get("X-Da-Status")    || "";
  const checksum  = res.headers.get("X-Checksum-Sha256") || "";
  const buffer    = await res.arrayBuffer();
  return { buffer, rootHash, saveIndex, daStatus, checksum };
}

// ── Metadata / Verify ─────────────────────────────────────────────────────────

export function getMetadata(wallet: string) {
  return req<{ wallet: string; saves: any[]; onChain: any }>(`/player/save/metadata?wallet=${wallet}`);
}

export function verify(wallet: string) {
  return req<{ wallet: string; saveIndex: number; layers: Record<string, boolean>; allPassed: boolean }>(
    `/player/verify?wallet=${wallet}`
  );
}

// ── UX endpoints ──────────────────────────────────────────────────────────────

export function getDashboard(jwt: string) {
  return req<any>("/0g/dashboard", { headers: { Authorization: `Bearer ${jwt}` } });
}

export function getActivity(jwt: string, page = 1) {
  return req<any>(`/0g/activity?page=${page}&limit=20`, { headers: { Authorization: `Bearer ${jwt}` } });
}

export function getBadge(jwt: string) {
  return req<any>("/0g/badge", { headers: { Authorization: `Bearer ${jwt}` } });
}

export function getNetworkStatus() {
  return req<any>("/0g/network");
}

export function getVerifiedLeaderboard(filter = "finalized") {
  return req<any>(`/0g/leaderboard/verified?filter=${filter}`);
}

export function getExplorer(wallet: string) {
  return req<any>(`/0g/explorer/${wallet}`);
}

export function getStats() {
  return req<any>("/stats");
}
