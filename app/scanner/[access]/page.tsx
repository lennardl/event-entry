"use client";

import { useEffect, useRef, useState } from "react";
import { readStored, writeStored } from "../../../lib/browser-storage";

type Access = { gateName: string; expiresAt: string };
type Result = { ok: boolean; reason?: string; quantity?: number; remaining?: number; zoneName?: string; offline?: boolean };
type PackTicket = { token: string; id: string; zoneName: string; remainingEntries: number; status: string };
type OfflinePack = { expiresAt: string; tickets: PackTicket[] };
type PendingScan = { requestId: string; token: string; quantity: number };

const PACK_PREFIX = "event-entry-gate-pack:";
const PENDING_PREFIX = "event-entry-gate-pending:";

export default function GateScannerPage({ params }: { params: Promise<{ access: string }> }) {
  const [accessToken, setAccessToken] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [ticketToken, setTicketToken] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop(): void } | null>(null);
  const storageKey = `${PACK_PREFIX}${accessToken}`;
  const pendingKey = `${PENDING_PREFIX}${accessToken}`;

  function readPack() { return readStored<OfflinePack | null>(storageKey, null); }
  function readPending() { return readStored<PendingScan[]>(pendingKey, []); }
  function writePending(items: PendingScan[]) { writeStored(pendingKey, items); setPendingCount(items.length); }
  async function downloadPack() {
    const response = await fetch("/api/scanner/pack", { cache: "no-store", headers: { "x-gate-access": accessToken } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    writeStored(storageKey, data);
  }
  async function submit(item: PendingScan) {
    const response = await fetch("/api/scanner/scan", { method: "POST", headers: { "content-type": "application/json", "x-gate-access": accessToken }, body: JSON.stringify({ token: item.token, quantity: item.quantity, requestId: item.requestId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data as Result;
  }
  async function checkConnection() {
    if (!accessToken) return;
    try {
      const response = await fetch("/api/scanner/access", { cache: "no-store", headers: { "x-gate-access": accessToken } });
      if (!response.ok) throw new Error("Scanner access is unavailable");
      const data = await response.json();
      setAccess(data.access); setOnline(true);
      const pending = readPending();
      const unresolved: PendingScan[] = [];
      let conflicts = 0;
      for (const item of pending) { try { if (!(await submit(item)).ok) { unresolved.push(item); conflicts += 1; } } catch { unresolved.push(item); } }
      writePending(unresolved);
      if (conflicts) setError(`${conflicts} offline admission${conflicts === 1 ? " requires" : "s require"} supervisor review.`);
      if (!pending.length) await downloadPack();
    } catch { setOnline(false); }
  }
  function admitOffline(requestId: string) {
    const pack = readPack();
    if (!pack || Date.parse(pack.expiresAt) <= Date.now()) throw new Error("No current offline pack. Connect to the system before allowing entry.");
    const ticket = pack.tickets.find((item) => item.token === ticketToken);
    if (!ticket || ticket.status !== "active") throw new Error("Ticket is not valid in this device’s offline pack");
    if (ticket.remainingEntries < quantity) throw new Error(`Only ${ticket.remainingEntries} admission${ticket.remainingEntries === 1 ? "" : "s"} remain on this ticket`);
    ticket.remainingEntries -= quantity;
    writeStored(storageKey, pack);
    writePending([...readPending(), { requestId, token: ticketToken, quantity }]);
    setResult({ ok: true, offline: true, quantity, remaining: ticket.remainingEntries, zoneName: ticket.zoneName });
    setTicketToken("");
  }

  useEffect(() => { void params.then(({ access }) => setAccessToken(access)); }, [params]);
  useEffect(() => { if (accessToken) queueMicrotask(() => { setPendingCount(readPending().length); void checkConnection(); }); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const interval = window.setInterval(() => void checkConnection(), 10_000);
    const onOnline = () => void checkConnection();
    window.addEventListener("online", onOnline);
    return () => { window.clearInterval(interval); window.removeEventListener("online", onOnline); };
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => controlsRef.current?.stop(), []);
  async function openCamera() {
    if (!videoRef.current) return;
    setError("");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      controlsRef.current?.stop();
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (scan) => { if (scan) { setTicketToken(scan.getText()); controlsRef.current?.stop(); } });
    } catch { setError("Camera could not start. Check the device permission or paste the ticket token."); }
  }
  async function scan() {
    if (!ticketToken || busy) return;
    const requestId = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      if (!online) { admitOffline(requestId); return; }
      const response = await submit({ requestId, token: ticketToken, quantity });
      setResult(response); navigator.vibrate?.(response.ok ? [60, 40, 90] : [180, 80, 180]);
      if (response.ok) { const pack = readPack(); const ticket = pack?.tickets.find((item) => item.token === ticketToken); if (ticket) { ticket.remainingEntries = response.remaining ?? ticket.remainingEntries; writeStored(storageKey, pack); } setTicketToken(""); }
    } catch (reason) {
      try { admitOffline(requestId); setOnline(false); } catch (offlineReason) { setError(offlineReason instanceof Error ? offlineReason.message : (reason instanceof Error ? reason.message : "Scan failed")); }
    } finally { setBusy(false); }
  }
  if (error && !access && !readPack()) return <main className="gate-screen"><h1>Scanner unavailable</h1><p>{error}</p></main>;
  if (!access && !readPack()) return <main className="gate-screen"><p>Opening gate scanner…</p></main>;
  return <main className="gate-screen"><span>{online ? "RESTRICTED GATE DEVICE · ONLINE" : "RESTRICTED GATE DEVICE · OFFLINE"}</span><h1>{access?.gateName ?? "Gate"} scanner</h1><p>{access ? `Access expires ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(access.expiresAt))}` : "Using the last valid offline pack"}</p><p>{pendingCount ? `${pendingCount} offline admission${pendingCount === 1 ? "" : "s"} awaiting sync` : "Scanner synchronised"}</p><video ref={videoRef} muted playsInline aria-label="Ticket camera feed" /><button className="gate-camera-button" onClick={() => void openCamera()}>Open camera and scan</button><label>Ticket token<input value={ticketToken} onChange={(event) => setTicketToken(event.target.value)} placeholder="Scan or paste ticket QR token" /></label><label>Admissions now<select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value}>{value}</option>)}</select></label><button onClick={() => void scan()} disabled={busy || !ticketToken}>{busy ? "Confirming…" : online ? "Confirm entry" : "Allow from offline pack"}</button>{error ? <p className="gate-error">{error}</p> : null}{result ? <section className={result.ok ? "gate-result allowed" : "gate-result denied"} role="status" aria-live="assertive"><strong>{result.ok ? result.offline ? "OFFLINE ENTRY RECORDED" : "ENTRY CONFIRMED" : "DO NOT ALLOW"}</strong><p>{result.ok ? `${result.quantity} admitted · ${result.remaining} remaining · ${result.zoneName} Zone` : result.reason}</p></section> : null}</main>;
}
