"use client";

import { useEffect, useRef, useState } from "react";

type Access = { gateName: string; expiresAt: string };
type Result = { ok: boolean; reason?: string; quantity?: number; remaining?: number; zoneName?: string };

export default function GateScannerPage({ params }: { params: Promise<{ access: string }> }) {
  const [accessToken, setAccessToken] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [ticketToken, setTicketToken] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop(): void } | null>(null);
  useEffect(() => { void params.then(({ access }) => setAccessToken(access)); }, [params]);
  useEffect(() => {
    if (!accessToken) return;
    fetch(`/api/scanner/access?access=${encodeURIComponent(accessToken)}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAccess(data.access);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Scanner access is unavailable"));
  }, [accessToken]);
  useEffect(() => () => controlsRef.current?.stop(), []);
  async function openCamera() {
    if (!videoRef.current) return;
    setError("");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      controlsRef.current?.stop();
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (scan) => {
        if (!scan) return;
        setTicketToken(scan.getText());
        controlsRef.current?.stop();
      });
    } catch { setError("Camera could not start. Check the device permission or paste the ticket token."); }
  }
  async function scan() {
    if (!ticketToken || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanner/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ access: accessToken, token: ticketToken, quantity, requestId: crypto.randomUUID() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data); if (data.ok) setTicketToken("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Scan failed"); } finally { setBusy(false); }
  }
  if (error && !access) return <main className="gate-screen"><h1>Scanner unavailable</h1><p>{error}</p></main>;
  if (!access) return <main className="gate-screen"><p>Opening gate scanner…</p></main>;
  return <main className="gate-screen"><span>RESTRICTED GATE DEVICE</span><h1>{access.gateName} scanner</h1><p>Access expires {new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(access.expiresAt))}</p><video ref={videoRef} muted playsInline aria-label="Ticket camera feed" /><button onClick={() => void openCamera()}>Open camera</button><label>Ticket token<input value={ticketToken} onChange={(event) => setTicketToken(event.target.value)} placeholder="Scan or paste ticket QR token" /></label><label>Admissions now<select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value}>{value}</option>)}</select></label><button onClick={() => void scan()} disabled={busy || !ticketToken}>{busy ? "Confirming…" : "Confirm entry"}</button>{error ? <p className="gate-error">{error}</p> : null}{result ? <section className={result.ok ? "gate-result allowed" : "gate-result denied"}><strong>{result.ok ? "ENTRY CONFIRMED" : "DO NOT ALLOW"}</strong><p>{result.ok ? `${result.quantity} admitted · ${result.remaining} remaining · ${result.zoneName} Zone` : result.reason}</p></section> : null}</main>;
}
