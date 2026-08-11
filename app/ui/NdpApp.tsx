"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppState, Role, TicketRecord } from "../../lib/types";
import "./ndp.css";

type View = "overview" | "tickets" | "scanner" | "exceptions" | "events";
type ScanResult = { ok: boolean; reason?: string; ticketId?: string; zoneName?: string; quantity?: number; remaining?: number };
type PendingScan = { id: string; token: string; quantity: number; gateId: string; createdAt: string };

const OFFLINE_PACK_KEY = "event-entry-offline-pack:v1";
const PENDING_SCANS_KEY = "event-entry-pending-scans:v1";
const OFFLINE_PACK_LIFETIME_MS = 4 * 60 * 60 * 1000;

const roles: Role[] = ["Super Admin", "Admin", "Gate Supervisor", "Command Centre Viewer"];
const viewAccess: Record<View, Role[]> = {
  overview: roles,
  tickets: ["Super Admin", "Admin", "Gate Supervisor"],
  scanner: ["Super Admin", "Admin", "Gate Supervisor"],
  exceptions: ["Super Admin", "Admin", "Gate Supervisor"],
  events: ["Super Admin", "Admin"],
};

const navItems: Array<{ id: View; label: string; marker: string }> = [
  { id: "overview", label: "Command overview", marker: "◎" },
  { id: "tickets", label: "Tickets", marker: "▤" },
  { id: "scanner", label: "Gate scanner", marker: "⌗" },
  { id: "exceptions", label: "Exceptions", marker: "!" },
  { id: "events", label: "Event setup", marker: "◇" },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-SG").format(value);
}

async function requestAction(body: Record<string, unknown>) {
  const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Action failed");
  return data;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

export function NdpApp() {
  const router = useRouter();
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("overview");
  const [role, setRole] = useState<Role>("Super Admin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load operations data");
      setState(data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load operations data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    registerServiceWorker();
    const queryView = new URLSearchParams(window.location.search).get("view") as View | null;
    if (queryView && navItems.some((item) => item.id === queryView)) queueMicrotask(() => setView(queryView));
    queueMicrotask(() => void load());
  }, [load]);

  function navigate(next: View) {
    if (!viewAccess[next].includes(role)) return;
    setView(next);
    setSidebarOpen(false);
    window.history.replaceState(null, "", `/?view=${next}`);
  }

  if (loading) return <LoadingScreen />;
  if (!state || error) return <ErrorScreen message={error || "No event data found"} retry={load} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark"><span>SG</span><small>60+</small></div>
          <div><strong>Event Entry</strong><span>Operations control</span></div>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => {
            const allowed = viewAccess[item.id].includes(role);
            return (
              <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} disabled={!allowed} title={allowed ? item.label : `Not available to ${role}`}>
                <span className="nav-marker" aria-hidden="true">{item.marker}</span>{item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          <div><strong>Systems operational</strong><span>Last checked just now</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation">☰</button>
          <div className="event-switcher">
            <span className="eyebrow">Active show</span>
            <strong>{state.event.name}</strong>
            <span>{state.event.venue} · {state.event.entryWindowStart}–{state.event.entryWindowEnd}</span>
          </div>
          <div className="topbar-actions">
            <div className="live-pill"><span /> LIVE</div>
            <label className="role-switcher">
              <span>Demo role</span>
              <select value={role} onChange={(event) => {
                const nextRole = event.target.value as Role;
                setRole(nextRole);
                if (!viewAccess[view].includes(nextRole)) navigate("overview");
              }}>
                {roles.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <button className="avatar" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>MO</button>
          </div>
        </header>

        <div className="content">
          {view === "overview" ? <Overview state={state} refresh={load} /> : null}
          {view === "tickets" ? <Tickets state={state} refresh={load} onSelect={setSelectedTicket} role={role} /> : null}
          {view === "scanner" ? <Scanner state={state} refresh={load} /> : null}
          {view === "exceptions" ? <Exceptions state={state} refresh={load} role={role} /> : null}
          {view === "events" ? <><EventSetup state={state} /><GateAccessLauncher gates={state.gates} /></> : null}
        </div>
      </main>
      {selectedTicket ? <TicketDrawer ticket={selectedTicket} event={state.event} onClose={() => setSelectedTicket(null)} refresh={load} role={role} /> : null}
    </div>
  );
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="pulse-logo">SG</div><strong>Preparing Event Entry</strong><span>Loading event operations…</span></div>;
}

function ErrorScreen({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div className="loading-screen"><div className="pulse-logo error">!</div><strong>Unable to open operations</strong><span>{message}</span><button className="primary-button" onClick={() => void retry()}>Try again</button></div>;
}

function Overview({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const pct = state.event.capacity ? Math.round((state.metrics.admitted / state.event.capacity) * 1000) / 10 : 0;
  const zoneStats = state.zones.map((zone) => {
    const allocated = state.tickets.filter((ticket) => ticket.zoneId === zone.id).reduce((sum, ticket) => sum + ticket.maxEntries, 0);
    const admitted = state.tickets.filter((ticket) => ticket.zoneId === zone.id).reduce((sum, ticket) => sum + ticket.usedEntries, 0);
    return { ...zone, allocated, admitted };
  });
  return (
    <section>
      <PageHeading eyebrow="Command centre" title="Entry operations at a glance" subtitle="Live attendance, gate throughput and issues requiring attention." action={<button className="secondary-button" onClick={() => void refresh()}>↻ Refresh</button>} />
      <div className="metrics-grid">
        <MetricCard label="Checked in" value={compactNumber(state.metrics.admitted)} detail={`${pct}% of venue capacity`} accent="red" />
        <MetricCard label="Admissions issued" value={compactNumber(state.metrics.allocated)} detail={`${compactNumber(state.metrics.remaining)} still available`} />
        <MetricCard label="Entry rate" value={`${state.metrics.entryRate}/min`} detail="Last 5 minutes" accent="blue" />
        <MetricCard label="Active issues" value={String(state.metrics.deniedAttempts)} detail={`${state.metrics.offlineAdmissions} offline admissions`} accent={state.metrics.deniedAttempts ? "amber" : "green"} />
      </div>

      <div className="dashboard-grid">
        <article className="panel capacity-panel">
          <div className="panel-title"><div><span className="eyebrow">Venue capacity</span><h2>{compactNumber(state.metrics.admitted)} inside</h2></div><strong>{pct}%</strong></div>
          <div className="capacity-track"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          <div className="capacity-labels"><span>0</span><span>{compactNumber(state.event.capacity)} maximum</span></div>
          <div className="zone-list">
            {zoneStats.map((zone) => (
              <div className="zone-row" key={zone.id}>
                <span className="zone-dot" style={{ background: zone.colour }} />
                <strong>{zone.name}</strong>
                <div className="mini-track"><span style={{ width: `${zone.allocated ? (zone.admitted / zone.allocated) * 100 : 0}%`, background: zone.colour }} /></div>
                <span>{zone.admitted} / {zone.allocated || "—"}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title"><div><span className="eyebrow">Gate health</span><h2>All entry points</h2></div><span className="healthy-badge">4 online</span></div>
          <div className="gate-cards">
            {state.gates.map((gate, index) => {
              const gateEntries = state.scans.filter((scan) => scan.gateId === gate.id && scan.result === "allowed").reduce((sum, scan) => sum + scan.quantity, 0);
              const queue = [4, 7, 3, 6][index] || 4;
              return <div className="gate-card" key={gate.id}><div><span className="status-dot" /><strong>{gate.name}</strong></div><span>{gateEntries} entered</span><small>~{queue} min wait</small></div>;
            })}
          </div>
          <div className="queue-note"><strong>Queue estimates</strong><span>Supervisor count ÷ recent gate throughput</span></div>
        </article>
      </div>

      <article className="panel activity-panel">
        <div className="panel-title"><div><span className="eyebrow">Latest activity</span><h2>Entry feed</h2></div><span className="subtle">Auto-updates online</span></div>
        <ScanTable scans={state.scans.slice(0, 8)} />
      </article>
    </section>
  );
}

function MetricCard({ label, value, detail, accent = "navy" }: { label: string; value: string; detail: string; accent?: string }) {
  return <article className={`metric-card ${accent}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function Tickets({ state, refresh, onSelect, role }: { state: AppState; refresh: () => Promise<void>; onSelect: (ticket: TicketRecord) => void; role: Role }) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const filtered = state.tickets.filter((ticket) => (format === "all" || ticket.format === format) && `${ticket.id} ${ticket.maskedNric} ${ticket.mobile}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section>
      <PageHeading eyebrow="Ticket operations" title="Issued tickets" subtitle="Electronic bundles and individual physical tickets share one entry ledger." action={role === "Gate Supervisor" ? undefined : <button className="primary-button" onClick={() => setImportOpen(true)}>＋ Upload winners</button>} />
      <div className="toolbar panel">
        <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticket, NRIC or mobile" /></label>
        <select value={format} onChange={(event) => setFormat(event.target.value)}><option value="all">All formats</option><option value="e-ticket">E-tickets</option><option value="physical">Physical</option></select>
        <span className="toolbar-count">{filtered.length} ticket records</span>
      </div>
      <article className="panel table-panel">
        <div className="ticket-table table-head"><span>Ticket</span><span>Recipient</span><span>Zone</span><span>Format</span><span>Usage</span><span>Status</span><span /></div>
        {filtered.map((ticket) => (
          <button className="ticket-table table-row" key={ticket.id} onClick={() => onSelect(ticket)}>
            <strong className="mono">{ticket.id}</strong>
            <span><strong>{ticket.maskedNric}</strong><small>{ticket.mobile}</small></span>
            <span><i className="zone-dot" style={{ background: ticket.zoneColour }} />{ticket.zoneName}</span>
            <span className="format-pill">{ticket.format === "e-ticket" ? "E-ticket bundle" : "Physical"}</span>
            <span><strong>{ticket.usedEntries} / {ticket.maxEntries}</strong><small>{ticket.remainingEntries} remaining</small></span>
            <span className="status-label active">Active</span>
            <span>›</span>
          </button>
        ))}
      </article>
      {importOpen ? <ImportDialog state={state} onClose={() => setImportOpen(false)} onComplete={async () => { setImportOpen(false); await refresh(); }} /> : null}
    </section>
  );
}

function Scanner({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop(): void } | null>(null);
  const [gateId, setGateId] = useState(state.gates[0]?.id || "gate-a");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const pack = (() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(localStorage.getItem(OFFLINE_PACK_KEY) || "null") as { updatedAt: string; expiresAt: string; tickets: Array<{ token: string; id: string; zoneName: string; zoneColour: string; remainingEntries: number; status: string }> } | null; } catch { return null; }
  })();

  const pendingCount = typeof window === "undefined" ? 0 : (() => { try { return (JSON.parse(localStorage.getItem(PENDING_SCANS_KEY) || "[]") as PendingScan[]).length; } catch { return 0; } })();

  useEffect(() => {
    if (!navigator.onLine) return;
    const now = new Date();
    try {
      localStorage.setItem(OFFLINE_PACK_KEY, JSON.stringify({
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + OFFLINE_PACK_LIFETIME_MS).toISOString(),
        eventId: state.event.id,
        tickets: state.tickets.map((item) => ({ token: item.token, id: item.id, zoneName: item.zoneName, zoneColour: item.zoneColour, remainingEntries: item.remainingEntries, status: item.status })),
      }));
      localStorage.removeItem("ndp-offline-pack");
      localStorage.removeItem("ndp-pending-scans");
    } catch { /* Browser storage may be unavailable on restricted devices. */ }
  }, [state]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); controlsRef.current?.stop(); };
  }, []);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine) return;
    let pending: PendingScan[] = [];
    try { pending = JSON.parse(localStorage.getItem(PENDING_SCANS_KEY) || "[]") as PendingScan[]; } catch { return; }
    if (!pending.length) return;
    setSyncMessage(`Syncing ${pending.length} offline scan${pending.length === 1 ? "" : "s"}…`);
    const unresolved: PendingScan[] = [];
    for (const item of pending) {
      try {
        const response = await requestAction({ action: "scan", token: item.token, quantity: item.quantity, gateId: item.gateId, mode: "offline", requestId: item.id, operator: "Gate web scanner" });
        if (!response.ok) unresolved.push(item);
      } catch { unresolved.push(item); }
    }
    localStorage.setItem(PENDING_SCANS_KEY, JSON.stringify(unresolved));
    setSyncMessage(unresolved.length ? `${unresolved.length} scan conflict${unresolved.length === 1 ? "" : "s"} need review` : "Offline scans synchronised");
    await refresh();
  }, [refresh]);

  useEffect(() => { if (online) queueMicrotask(() => void syncPending()); }, [online, syncPending]);

  function selectToken(token: string) {
    const selected = state.tickets.find((item) => item.token === token);
    if (!selected) {
      setTicket(null);
      setResult({ ok: false, reason: "Ticket is invalid or not in this show’s offline pack" });
      return;
    }
    setResult(null);
    setTicket(selected);
    setQuantity(1);
    setRequestId(crypto.randomUUID());
    controlsRef.current?.stop();
    setCameraActive(false);
  }

  async function startCamera() {
    if (!videoRef.current) return;
    setResult(null);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      setCameraActive(true);
      controlsRef.current = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (scan) => {
        if (scan) selectToken(scan.getText());
      });
    } catch {
      setCameraActive(false);
      setResult({ ok: false, reason: "Camera could not start. Check browser camera permission or use a demo ticket below." });
    }
  }

  async function confirmAdmission() {
    if (!ticket || submitting) return;
    if (online) {
      setSubmitting(true);
      try {
        const response = await requestAction({ action: "scan", token: ticket.token, quantity, gateId, mode: "online", requestId: requestId ?? crypto.randomUUID(), operator: "Gate web scanner" }) as ScanResult;
        setResult(response);
        if (response.ok) setTicket(null);
        await refresh();
      } catch {
        setResult({ ok: false, reason: "Scan could not be confirmed. Retry to safely check the same request." });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const localTicket = pack?.tickets.find((item) => item.token === ticket.token);
    // This check runs only after the operator confirms an offline admission.
    // eslint-disable-next-line react-hooks/purity
    if (!pack?.expiresAt || Date.parse(pack.expiresAt) <= Date.now()) { setResult({ ok: false, reason: "Offline pack has expired. Move the attendee to the exception queue." }); return; }
    if (!localTicket || localTicket.status !== "active") { setResult({ ok: false, reason: "Ticket is not valid in this offline pack" }); return; }
    if (quantity > localTicket.remainingEntries) { setResult({ ok: false, reason: `Only ${localTicket.remainingEntries} admission${localTicket.remainingEntries === 1 ? "" : "s"} remaining on this device` }); return; }
    localTicket.remainingEntries -= quantity;
    const storedPack = { ...pack, tickets: pack?.tickets || [] };
    localStorage.setItem(OFFLINE_PACK_KEY, JSON.stringify(storedPack));
    const queued: PendingScan[] = JSON.parse(localStorage.getItem(PENDING_SCANS_KEY) || "[]");
    queued.push({ id: crypto.randomUUID(), token: ticket.token, quantity, gateId, createdAt: new Date().toISOString() });
    localStorage.setItem(PENDING_SCANS_KEY, JSON.stringify(queued));
    setResult({ ok: true, ticketId: ticket.id, zoneName: ticket.zoneName, quantity, remaining: localTicket.remainingEntries });
    setTicket(null);
  }

  return (
    <section>
      <PageHeading eyebrow="Gate operations" title="Browser ticket scanner" subtitle="Fast online validation with an offline pack ready for network outages." action={<div className={`network-pill ${online ? "online" : "offline"}`}><span />{online ? "Online" : "Offline mode"}</div>} />
      <div className="scanner-layout">
        <article className="scanner-card">
          <div className="scanner-toolbar">
            <label><span>Operating gate</span><select value={gateId} onChange={(event) => setGateId(event.target.value)}>{state.gates.map((gate) => <option value={gate.id} key={gate.id}>{gate.name}</option>)}</select></label>
            <div className="pack-status"><span>✓</span><div><strong>Offline pack ready</strong><small>{pack ? `Updated ${formatTime(pack.updatedAt)}` : "Preparing…"}</small></div></div>
          </div>
          <div className={`camera-stage ${cameraActive ? "active" : ""}`}>
            <video ref={videoRef} muted playsInline aria-label="Ticket camera feed" />
            {!cameraActive ? <div className="camera-placeholder"><div className="scan-corners"><span>⌗</span></div><strong>Ready to scan</strong><span>Works with phone screens and printed QR codes</span><button className="primary-button large" onClick={() => void startCamera()}>Open camera</button></div> : <div className="camera-guide"><span /><span /><span /><span /></div>}
          </div>
          <div className="manual-token"><span>or paste a ticket token</span><div><input value={manualToken} onChange={(event) => setManualToken(event.target.value)} placeholder="NDP27.TKT…" /><button className="secondary-button" onClick={() => selectToken(manualToken)}>Check</button></div></div>
        </article>

        <aside className="scanner-side">
          {ticket ? <AdmissionConfirm ticket={ticket} quantity={quantity} busy={submitting} onQuantity={setQuantity} onConfirm={() => void confirmAdmission()} onCancel={() => setTicket(null)} /> : result ? <ResultCard result={result} onNext={() => setResult(null)} /> : <div className="panel empty-result"><span className="empty-icon">⌗</span><strong>Scan result appears here</strong><span>The operator will see a large allow or do-not-allow result.</span></div>}
          <article className="panel demo-tickets">
            <div className="panel-title"><div><span className="eyebrow">POC shortcuts</span><h2>Demo tickets</h2></div></div>
            {state.tickets.slice(0, 4).map((item) => <button key={item.id} onClick={() => selectToken(item.token)}><span className="zone-dot" style={{ background: item.zoneColour }} /><div><strong>{item.id}</strong><small>{item.remainingEntries} of {item.maxEntries} remaining</small></div><span>Scan ›</span></button>)}
          </article>
          <article className="panel sync-card"><div><span className={pendingCount ? "sync-warn" : "sync-ok"}>{pendingCount ? "↻" : "✓"}</span><div><strong>{pendingCount ? `${pendingCount} awaiting sync` : "Scanner synchronised"}</strong><span>{syncMessage || "No offline admissions pending"}</span></div></div>{pendingCount && online ? <button onClick={() => void syncPending()}>Sync now</button> : null}</article>
        </aside>
      </div>
    </section>
  );
}

function AdmissionConfirm({ ticket, quantity, busy, onQuantity, onConfirm, onCancel }: { ticket: TicketRecord; quantity: number; busy: boolean; onQuantity: (value: number) => void; onConfirm: () => void; onCancel: () => void }) {
  const max = Math.min(6, ticket.remainingEntries);
  return <article className="panel admission-card"><div className="admission-header"><span className="valid-symbol">✓</span><div><span>VALID TICKET</span><strong>{ticket.id}</strong></div></div><div className="zone-banner" style={{ borderColor: ticket.zoneColour }}><span className="zone-dot" style={{ background: ticket.zoneColour }} /><div><small>Assigned zone</small><strong>{ticket.zoneName}</strong></div><span>Admit at this gate</span></div><div className="remaining-callout"><strong>{ticket.remainingEntries}</strong><span>admissions remaining</span></div><fieldset><legend>How many are entering now?</legend><div className="quantity-grid">{Array.from({ length: max }, (_, index) => index + 1).map((value) => <button key={value} disabled={busy} className={quantity === value ? "selected" : ""} onClick={() => onQuantity(value)}>{value}</button>)}</div></fieldset><button className="allow-button" disabled={busy} onClick={onConfirm}>{busy ? "Confirming admission…" : `Admit ${quantity} ${quantity === 1 ? "person" : "people"}`}</button><button className="text-button" disabled={busy} onClick={onCancel}>Cancel</button></article>;
}

function ResultCard({ result, onNext }: { result: ScanResult; onNext: () => void }) {
  return <article className={`result-card ${result.ok ? "allowed" : "denied"}`}><div className="result-symbol">{result.ok ? "✓" : "×"}</div><span>{result.ok ? "ALLOW ENTRY" : "DO NOT ALLOW"}</span><h2>{result.ok ? `Admit ${result.quantity}` : result.reason}</h2>{result.ok ? <><div className="result-zone">Direct to <strong>{result.zoneName} Zone</strong></div><p>{result.remaining} admission{result.remaining === 1 ? "" : "s"} remaining on this ticket</p></> : <p>Move the attendee to the exception queue if they need help.</p>}<button onClick={onNext}>Scan next ticket</button></article>;
}

function Exceptions({ state, refresh, role }: { state: AppState; refresh: () => Promise<void>; role: Role }) {
  const [nric, setNric] = useState("");
  const [matches, setMatches] = useState<TicketRecord[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function lookup() {
    const response = await requestAction({ action: "lookup", nric });
    setMatches(response.tickets);
    setMessage(response.tickets.length ? null : "No allocation found for that NRIC.");
  }
  async function manualAdmit(ticket: TicketRecord) {
    const response = await requestAction({ action: "scan", token: ticket.token, quantity: 1, gateId: state.gates[0]?.id, mode: "manual", operator: role });
    setMessage(response.ok ? `Manual entry recorded. ${response.remaining} remaining.` : response.reason);
    await refresh();
    await lookup();
  }
  return <section><PageHeading eyebrow="Resolution queue" title="Help without blocking the gate" subtitle="Look up the original allocation, regenerate access or record a supervised manual entry." /><div className="exceptions-grid"><article className="panel lookup-panel"><div className="panel-title"><div><span className="eyebrow">NRIC recovery</span><h2>Find a ticket allocation</h2></div></div><p>Exact lookup only. NRIC is never stored in the scanner’s offline pack.</p><label><span>Recipient NRIC</span><div className="input-action"><input value={nric} onChange={(event) => setNric(event.target.value.toUpperCase())} placeholder="S1234567D" /><button className="primary-button" onClick={() => void lookup()}>Find allocation</button></div></label><div className="sample-hint">POC sample: <button onClick={() => setNric("S1234567D")}>S1234567D</button></div>{message ? <div className="inline-message">{message}</div> : null}{matches?.map((ticket) => <div className="lookup-result" key={ticket.id}><div><span className="zone-dot" style={{ background: ticket.zoneColour }} /><strong>{ticket.id}</strong><small>{ticket.zoneName} · {ticket.format}</small></div><div><strong>{ticket.remainingEntries} remaining</strong><span>{ticket.maskedNric}</span></div><button disabled={!ticket.remainingEntries} onClick={() => void manualAdmit(ticket)}>Manual admit 1</button></div>)}</article><article className="panel exception-feed"><div className="panel-title"><div><span className="eyebrow">Recent exceptions</span><h2>Denied and manual actions</h2></div></div><ScanTable scans={state.scans.filter((scan) => scan.result === "denied" || scan.mode === "manual")} empty="No exceptions recorded yet." /></article></div></section>;
}

function EventSetup({ state }: { state: AppState }) {
  const [selection, setSelection] = useState<{ kind: "zone" | "gate"; name: string; detail: string } | null>(null);
  return <section><PageHeading eyebrow="Event administration" title="Show configuration" subtitle="The POC uses one live rehearsal. The same structure supports all six NDP shows." /><div className="setup-grid"><article className="panel event-summary"><div className="event-hero"><span className="eyebrow">Current event</span><h2>{state.event.name}</h2><p>{state.event.venue}</p><span className="healthy-badge">{state.event.status}</span></div><dl><div><dt>Maximum capacity</dt><dd>{compactNumber(state.event.capacity)}</dd></div><div><dt>Entry window</dt><dd>{state.event.entryWindowStart}–{state.event.entryWindowEnd}</dd></div><div><dt>Ticket policy</dt><dd>1–6 per e-ticket bundle</dd></div><div><dt>Re-entry</dt><dd>Not allowed</dd></div></dl></article><article className="panel"><div className="panel-title"><div><span className="eyebrow">Zones</span><h2>Four configurable zones</h2></div></div><div className="setup-list">{state.zones.map((zone) => <div key={zone.id}><span className="zone-dot large" style={{ background: zone.colour }} /><div><strong>{zone.name} Zone</strong><span>{compactNumber(zone.capacity)} capacity</span></div><button onClick={() => setSelection({ kind: "zone", name: `${zone.name} Zone`, detail: `${compactNumber(zone.capacity)} admission capacity` })}>Configure</button></div>)}</div></article><article className="panel"><div className="panel-title"><div><span className="eyebrow">Entry points</span><h2>Gates accept every zone</h2></div></div><div className="setup-list">{state.gates.map((gate) => <div key={gate.id}><span className="gate-symbol">⌗</span><div><strong>{gate.name}</strong><span>All zones · Online + offline</span></div><button onClick={() => setSelection({ kind: "gate", name: gate.name, detail: "All zones · online admission validation" })}>Configure</button></div>)}</div></article><article className="panel production-note"><span>POC</span><h2>Production dependencies</h2><ul><li>MINDEF-approved SSO</li><li>.gov.sg SMS connection</li><li>Apple and Google Wallet issuer credentials</li><li>Managed scanner device provisioning</li></ul></article></div>{selection ? <div className="modal-backdrop"><div className="modal"><button className="drawer-close" onClick={() => setSelection(null)}>×</button><span className="eyebrow">{selection.kind} configuration</span><h2>{selection.name}</h2><p>{selection.detail}</p>{selection.kind === "gate" ? <p>Use the “Generate 24-hour scanner QR” panel below to issue this gate a restricted scanner link.</p> : <p>Zone capacity and colour are shown here. Editing event configuration is outside this POC.</p>}<div className="modal-actions"><button className="primary-button" onClick={() => setSelection(null)}>Done</button></div></div></div> : null}</section>;
}

function GateAccessLauncher({ gates }: { gates: AppState["gates"] }) {
  const [open, setOpen] = useState(false);
  const [gateId, setGateId] = useState(gates[0]?.id ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [accessId, setAccessId] = useState<string | null>(null);
  async function generate() {
    const response = await requestAction({ action: "createGateAccess", gateId });
    if (!response.access) return;
    const url = `${window.location.origin}/scanner/${response.access.token}`;
    setLink(url); setAccessId(response.access.id);
    const qrcode = await import("qrcode");
    setQr(await qrcode.toDataURL(url, { width: 480, margin: 2 }));
  }
  async function revoke() {
    if (accessId) await requestAction({ action: "revokeGateAccess", accessId });
    setOpen(false); setLink(null); setQr(""); setAccessId(null);
  }
  return <article className="panel production-note"><span>GATE DEVICE</span><h2>Share a restricted scanner</h2><p>Generate a QR code for a named gate. It works for 24 hours and never grants admin access.</p><button className="primary-button" onClick={() => setOpen(true)}>Generate 24-hour scanner QR</button>{open ? <div className="modal-backdrop"><div className="modal"><button className="drawer-close" onClick={() => setOpen(false)}>×</button><span className="eyebrow">Gate-only access</span><h2>{link ? "Scanner QR is ready" : "Choose a gate"}</h2>{link ? <><img src={qr} alt="QR code for the restricted scanner link" style={{ width: "min(280px, 100%)", display: "block", margin: "14px auto" }} /><p>Scan this on the gate device. The link expires in 24 hours and can be revoked here.</p><button className="danger-button" onClick={() => void revoke()}>Revoke scanner access</button></> : <><label className="role-switcher"><span>Operating gate</span><select value={gateId} onChange={(event) => setGateId(event.target.value)}>{gates.map((gate) => <option key={gate.id} value={gate.id}>{gate.name}</option>)}</select></label><div className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" onClick={() => void generate()}>Generate QR</button></div></>}</div></div> : null}</article>;
}

function TicketDrawer({ ticket, event, onClose, refresh, role }: { ticket: TicketRecord; event: AppState["event"]; onClose: () => void; refresh: () => Promise<void>; role: Role }) {
  const [qr, setQr] = useState<string>("");
  const [current, setCurrent] = useState(ticket);
  const [copied, setCopied] = useState(false);
  useEffect(() => { import("qrcode").then((module) => module.toDataURL(current.token, { width: 420, margin: 2, color: { dark: "#17213A", light: "#FFFFFF" } })).then(setQr); }, [current.token]);
  async function regenerate() {
    const response = await requestAction({ action: "regenerate", ticketId: current.id, expectedVersion: current.version, actor: role });
    if (response.result) setCurrent({ ...current, token: response.result.token, version: response.result.version });
    await refresh();
  }
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/ticket/${encodeURIComponent(current.token)}`;
  return <div className="drawer-backdrop" role="button" tabIndex={0} aria-label="Close ticket details" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="ticket-drawer"><button className="drawer-close" onClick={onClose} aria-label="Close ticket">×</button><div className="citizen-ticket" style={{ "--ticket-zone": current.zoneColour } as React.CSSProperties}><div className="ticket-brand"><div className="brand-mark small"><span>SG</span><small>60+</small></div><div><strong>NDP 2027</strong><span>Official admission ticket</span></div></div><div className="ticket-zone"><span>{current.zoneName}</span><strong>ZONE</strong></div><div className="ticket-event"><span>{event.name}</span><h2>{event.venue}</h2><div><span>Entry window</span><strong>{event.entryWindowStart}–{event.entryWindowEnd}</strong></div></div><div className="qr-wrap">{qr ? <img src={qr} alt={`QR code for ${current.id}`} /> : <span>Generating QR…</span>}</div><div className="ticket-count"><strong>{current.remainingEntries}</strong><span>of {current.maxEntries} admissions remaining</span></div><div className="ticket-id">{current.id} · Version {current.version}</div></div><div className="drawer-actions"><a className="wallet-button apple" href={`/api/wallet/apple?ticket=${current.id}`}><span></span><small>Add to</small><strong>Apple Wallet</strong></a><a className="wallet-button google" href={`/api/wallet/google?ticket=${current.id}`}><span>G</span><small>Save to</small><strong>Google Wallet</strong></a><button className="secondary-button full" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? "✓ Link copied" : "Copy ticket link"}</button><button className="danger-button" onClick={() => void regenerate()}>Regenerate lost ticket</button><small className="drawer-help">Regenerating immediately invalidates the previous QR while preserving admissions already used.</small></div></aside></div>;
}

function ImportDialog({ state, onClose, onComplete }: { state: AppState; onClose: () => void; onComplete: () => Promise<void> }) {
  const [csv, setCsv] = useState("NRIC,mobile,quantity,zone,format\nS7654321A,98765432,3,Red,e-ticket\nS8765432B,97654321,2,Blue,physical");
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const lines = csv.trim().split(/\r?\n/).slice(1);
    const rows = lines.map((line) => {
      const [nric, mobile, quantity, zoneName, format] = line.split(",").map((part) => part.trim());
      return { nric, mobile, quantity: Number(quantity), zoneId: state.zones.find((zone) => zone.name.toLowerCase() === zoneName.toLowerCase())?.id || state.zones[0].id, format: format === "physical" ? "physical" : "e-ticket" };
    });
    if (rows.some((row) => !row.nric || !row.mobile || row.quantity < 1 || row.quantity > 6)) { setError("Every row needs an NRIC, mobile number and quantity from 1 to 6."); return; }
    await requestAction({ action: "import", rows });
    await onComplete();
  }
  return <div className="modal-backdrop"><div className="modal"><button className="drawer-close" onClick={onClose}>×</button><span className="eyebrow">Winner import</span><h2>Upload ticket recipients</h2><p>This POC accepts a pasted CSV. Physical allocations create one QR per admission.</p><textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} spellCheck={false} />{error ? <div className="inline-message error">{error}</div> : null}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => void submit()}>Validate and issue</button></div></div></div>;
}

function ScanTable({ scans, empty = "No scans recorded yet." }: { scans: AppState["scans"]; empty?: string }) {
  if (!scans.length) return <div className="empty-table">{empty}</div>;
  return <div className="scan-table"><div className="scan-head"><span>Time</span><span>Ticket</span><span>Gate</span><span>Admission</span><span>Mode</span><span>Result</span></div>{scans.map((scan) => <div className="scan-row" key={scan.id}><span>{formatTime(scan.createdAt)}</span><strong className="mono">{scan.ticketId}</strong><span>{scan.gateName}</span><span>{scan.quantity} {scan.quantity === 1 ? "person" : "people"}</span><span className="mode-pill">{scan.mode}</span><span className={`status-label ${scan.result}`}>{scan.result}</span></div>)}</div>;
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action ? <div>{action}</div> : null}</div>;
}
