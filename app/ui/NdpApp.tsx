"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppState, Role, TicketRecord } from "../../lib/types";
import { readStored, removeStored, writeStored } from "../../lib/browser-storage";
import "./ndp.css";
import "./a11y.css";

type View = "overview" | "tickets" | "scanner" | "exceptions" | "events";
type ScanResult = { ok: boolean; reason?: string; ticketId?: string; zoneName?: string; quantity?: number; remaining?: number };
type PendingScan = { id: string; token: string; quantity: number; gateId: string; createdAt: string };

const OFFLINE_PACK_KEY = "event-entry-offline-pack:v1";
const PENDING_SCANS_KEY = "event-entry-pending-scans:v1";
const OFFLINE_PACK_LIFETIME_MS = 4 * 60 * 60 * 1000;
const timeFormatter = new Intl.DateTimeFormat("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const numberFormatter = new Intl.NumberFormat("en-SG");

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
  return timeFormatter.format(new Date(value));
}

function compactNumber(value: number) {
  return numberFormatter.format(value);
}

async function requestAction(body: Record<string, unknown>) {
  const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Action failed. Please try again.");
  return data;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

export function NdpApp({ initialState = null, initialError = null }: { initialState?: AppState | null; initialError?: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<AppState | null>(initialState);
  const [view, setView] = useState<View>("overview");
  const [role, setRole] = useState<Role>("Super Admin");
  const [loading, setLoading] = useState(!initialState);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const loadInFlight = useRef<Promise<void> | null>(null);
  const currentEventId = useRef(initialState?.event.id);

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  const load = useCallback((eventId?: string) => {
    if (loadInFlight.current) return loadInFlight.current;
    setRefreshing(true);
    const request = (async () => {
      try {
        const selectedEventId = eventId ?? currentEventId.current;
        const response = await fetch(selectedEventId ? `/api/state?eventId=${encodeURIComponent(selectedEventId)}` : "/api/state", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load operations data");
        setState(data as AppState);
        currentEventId.current = (data as AppState).event.id;
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load operations data");
      } finally {
        setLoading(false);
        setRefreshing(false);
        loadInFlight.current = null;
      }
    })();
    loadInFlight.current = request;
    return request;
  }, [router]);

  useEffect(() => {
    registerServiceWorker();
    const queryView = new URLSearchParams(window.location.search).get("view") as View | null;
    if (queryView && navItems.some((item) => item.id === queryView)) queueMicrotask(() => setView(queryView));
    if (!initialState) queueMicrotask(() => void load());
  }, [initialState, load]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  function navigate(next: View) {
    if (!viewAccess[next].includes(role)) return;
    setView(next);
    setSidebarOpen(false);
    window.history.replaceState(null, "", `/?view=${next}&event=${encodeURIComponent(state?.event.id ?? "")}`);
  }

  async function switchEvent(eventId: string) {
    setSelectedTicket(null);
    await load(eventId);
    window.history.replaceState(null, "", `/?view=${view}&event=${encodeURIComponent(eventId)}`);
  }

  if (loading) return <LoadingScreen />;
  if (!state) return <ErrorScreen message={error || "No event data found"} retry={load} />;

  return (
    <div className="app-shell">
      {sidebarOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} aria-label="Operations navigation">
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
          <button className="menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation" aria-expanded={sidebarOpen}>☰</button>
          <div className="event-switcher">
            <span className="eyebrow">Active show</span>
            <select value={state.event.id} onChange={(event) => void switchEvent(event.target.value)} aria-label="Active event">
              {state.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </select>
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
          {error ? <div className="refresh-alert" role="status"><span><strong>Live data could not refresh.</strong> Showing the last successful update.</span><button onClick={() => void load()} disabled={refreshing}>{refreshing ? "Retrying…" : "Retry"}</button></div> : null}
          {view === "overview" ? <Overview state={state} refresh={load} /> : null}
          {view === "tickets" ? <Tickets key={state.event.id} state={state} refresh={load} onSelect={setSelectedTicket} role={role} /> : null}
          {view === "scanner" ? <Scanner key={state.event.id} state={state} refresh={load} /> : null}
          {view === "exceptions" ? <Exceptions key={state.event.id} state={state} refresh={load} role={role} /> : null}
          {view === "events" ? <EventSetup key={state.event.id} state={state} onEventCreated={switchEvent} /> : null}
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
  const zoneStats = useMemo(() => {
    const totals = new Map<string, { allocated: number; admitted: number }>();
    for (const ticket of state.tickets) {
      const current = totals.get(ticket.zoneId) ?? { allocated: 0, admitted: 0 };
      current.allocated += ticket.maxEntries;
      current.admitted += ticket.usedEntries;
      totals.set(ticket.zoneId, current);
    }
    return state.zones.map((zone) => ({ ...zone, ...(totals.get(zone.id) ?? { allocated: 0, admitted: 0 }) }));
  }, [state.tickets, state.zones]);
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
  const [pack, setPack] = useState<{ updatedAt: string; expiresAt: string; tickets: Array<{ token: string; id: string; zoneName: string; zoneColour: string; remainingEntries: number; status: string }> } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!navigator.onLine) {
      try {
        const storedPack = readStored(OFFLINE_PACK_KEY, null);
        const storedPendingCount = readStored<PendingScan[]>(PENDING_SCANS_KEY, []).length;
        queueMicrotask(() => { setPack(storedPack); setPendingCount(storedPendingCount); });
      } catch { /* Ignore unavailable or corrupt browser storage. */ }
      return;
    }
    const now = new Date();
    const nextPack = {
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OFFLINE_PACK_LIFETIME_MS).toISOString(),
      eventId: state.event.id,
      tickets: state.tickets.map((item) => ({ token: item.token, id: item.id, zoneName: item.zoneName, zoneColour: item.zoneColour, remainingEntries: item.remainingEntries, status: item.status })),
    };
    try {
      writeStored(OFFLINE_PACK_KEY, nextPack);
      removeStored("ndp-offline-pack");
      removeStored("ndp-pending-scans");
      const storedPendingCount = readStored<PendingScan[]>(PENDING_SCANS_KEY, []).length;
      queueMicrotask(() => { setPack(nextPack); setPendingCount(storedPendingCount); });
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
    pending = readStored<PendingScan[]>(PENDING_SCANS_KEY, []);
    if (!pending.length) return;
    setSyncMessage(`Syncing ${pending.length} offline scan${pending.length === 1 ? "" : "s"}…`);
    const unresolved: PendingScan[] = [];
    for (const item of pending) {
      try {
        const response = await requestAction({ action: "scan", token: item.token, quantity: item.quantity, gateId: item.gateId, mode: "offline", requestId: item.id, operator: "Gate web scanner" });
        if (!response.ok) unresolved.push(item);
      } catch { unresolved.push(item); }
    }
    writeStored(PENDING_SCANS_KEY, unresolved);
    setPendingCount(unresolved.length);
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
    if (!pack?.expiresAt || Date.parse(pack.expiresAt) <= Date.now()) { setResult({ ok: false, reason: "Offline pack has expired. Move the attendee to the exception queue." }); return; }
    if (!localTicket || localTicket.status !== "active") { setResult({ ok: false, reason: "Ticket is not valid in this offline pack" }); return; }
    if (quantity > localTicket.remainingEntries) { setResult({ ok: false, reason: `Only ${localTicket.remainingEntries} admission${localTicket.remainingEntries === 1 ? "" : "s"} remaining on this device` }); return; }
    localTicket.remainingEntries -= quantity;
    const storedPack = { ...pack, tickets: pack?.tickets || [] };
    writeStored(OFFLINE_PACK_KEY, storedPack);
    setPack(storedPack);
    const queued = readStored<PendingScan[]>(PENDING_SCANS_KEY, []);
    queued.push({ id: crypto.randomUUID(), token: ticket.token, quantity, gateId, createdAt: new Date().toISOString() });
    writeStored(PENDING_SCANS_KEY, queued);
    setPendingCount(queued.length);
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
  useEffect(() => {
    navigator.vibrate?.(result.ok ? [60, 40, 90] : [180, 80, 180]);
    const audio = new AudioContext(); const oscillator = audio.createOscillator(); const gain = audio.createGain();
    oscillator.frequency.value = result.ok ? 880 : 220; gain.gain.value = .05; oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .14);
    return () => { oscillator.disconnect(); gain.disconnect(); void audio.close(); };
  }, [result]);
  return <article className={`result-card ${result.ok ? "allowed" : "denied"}`} role="status" aria-live="assertive"><div className="result-symbol">{result.ok ? "✓" : "×"}</div><span>{result.ok ? "ALLOW ENTRY" : "DO NOT ALLOW"}</span><h2>{result.ok ? `Admit ${result.quantity}` : result.reason}</h2>{result.ok ? <><div className="result-zone">Direct to <strong>{result.zoneName} Zone</strong></div><p>{result.remaining} admission{result.remaining === 1 ? "" : "s"} remaining on this ticket</p></> : <p>Move the attendee to the exception queue if they need help.</p>}<button onClick={onNext}>Scan next ticket</button></article>;
}

function Exceptions({ state, refresh, role }: { state: AppState; refresh: () => Promise<void>; role: Role }) {
  const [nric, setNric] = useState("");
  const [matches, setMatches] = useState<TicketRecord[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function lookup() {
    const response = await requestAction({ action: "lookup", eventId: state.event.id, nric });
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

function EventSetup({ state, onEventCreated }: { state: AppState; onEventCreated: (eventId: string) => Promise<void> }) {
  const [selection, setSelection] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const router = useRouter();
  const ready = state.gates.length && state.zones.length && !state.metrics.deniedAttempts;
  return <section><PageHeading eyebrow="Event setup" title="Set up this event" subtitle="Create events and configure each event’s zones, gates, tickets and scanner access." action={<button className="primary-button" onClick={() => setCreateOpen(true)}>＋ Create event</button>} /><article className="panel event-list"><div className="panel-title"><div><span className="eyebrow">All events</span><h2>{state.events.length} configured</h2></div></div>{state.events.map((event) => <div key={event.id} className={event.id === state.event.id ? "event-list-row active" : "event-list-row"}><div><strong>{event.name}</strong><span>{event.venue} · {event.entryWindowStart}–{event.entryWindowEnd}</span></div><span className={`status-label ${event.status === "live" ? "allowed" : ""}`}>{event.status}</span><span>{compactNumber(event.ticketCount)} tickets · {compactNumber(event.admitted)} admitted</span>{event.id === state.event.id ? <strong>Active</strong> : <button onClick={() => void onEventCreated(event.id)}>Open</button>}</div>)}</article><div className="setup-grid"><SetupCard eyebrow="Event details" title={state.event.name} detail={`${state.event.venue} · ${state.event.entryWindowStart}–${state.event.entryWindowEnd}`} metric={`${compactNumber(state.event.capacity)} capacity`} action="Review event" onAction={() => setSelection("Event details")} /><SetupCard eyebrow="Ticket design" title={state.event.ticketTheme.brandName} detail={state.event.ticketTheme.ticketTitle} metric="Event-specific branding" action="Customise ticket" onAction={() => setThemeOpen(true)} /><SetupCard eyebrow="Entry zones" title={`${state.zones.length} zones configured`} detail={`${compactNumber(state.event.capacity)} total admission capacity`} metric="Ready" action="Manage zones" onAction={() => setSelection("Entry zones")} /><SetupCard eyebrow="Gates and devices" title={`${state.gates.length} gates ready`} detail="Every gate accepts every zone, online or offline." metric="Ready" action="Manage gates" onAction={() => setSelection("Gates and devices")} /><GateAccessLauncher gates={state.gates} eventId={state.event.id} /><SetupCard eyebrow="Readiness" title={ready ? "Ready for gates" : "Needs attention"} detail={ready ? "All gates and zones are configured. No current exceptions." : `${state.metrics.deniedAttempts} exception${state.metrics.deniedAttempts === 1 ? "" : "s"} need review.`} metric={`${state.metrics.offlineAdmissions} offline syncs`} action="Open command overview" onAction={() => router.push(`/?view=overview&event=${encodeURIComponent(state.event.id)}`)} /></div>{createOpen ? <CreateEventDialog onClose={() => setCreateOpen(false)} onCreated={async (eventId) => { setCreateOpen(false); await onEventCreated(eventId); }} /> : null}{themeOpen ? <TicketThemeDialog event={state.event} onClose={() => setThemeOpen(false)} onSaved={async () => { setThemeOpen(false); await onEventCreated(state.event.id); }} /> : null}{selection ? <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title"><button className="drawer-close" onClick={() => setSelection(null)}>×</button><span className="eyebrow">Event setup</span><h2 id="setup-title">{selection}</h2><p>Detailed editing for this event can be added here without affecting other event ledgers.</p><div className="modal-actions"><button className="primary-button" onClick={() => setSelection(null)}>Done</button></div></div></div> : null}</section>;
}

function TicketThemeDialog({ event, onClose, onSaved }: { event: AppState["event"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [theme, setTheme] = useState(event.ticketTheme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (field: keyof typeof theme, value: string) => setTheme((current) => ({ ...current, [field]: value }));
  async function save() {
    setBusy(true); setError(null);
    try {
      await requestAction({ action: "updateTicketTheme", eventId: event.id, ...theme });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ticket design could not be saved");
      setBusy(false);
    }
  }
  return <div className="modal-backdrop"><div className="modal ticket-theme-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-theme-title"><button className="drawer-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">Ticket design</span><h2 id="ticket-theme-title">Customise {event.name}</h2><div className="theme-editor"><div className="event-form form-grid"><label><span>Brand name</span><input value={theme.brandName} maxLength={50} onChange={(e) => update("brandName", e.target.value)} /></label><label><span>Ticket title</span><input value={theme.ticketTitle} maxLength={80} onChange={(e) => update("ticketTitle", e.target.value)} /></label><label><span>Primary colour</span><input type="color" value={theme.primaryColour} onChange={(e) => update("primaryColour", e.target.value)} /></label><label><span>Accent colour</span><input type="color" value={theme.accentColour} onChange={(e) => update("accentColour", e.target.value)} /></label><label className="full"><span>Attendee instructions</span><textarea value={theme.instructions} maxLength={300} rows={4} onChange={(e) => update("instructions", e.target.value)} /></label></div><TicketThemePreview event={event} theme={theme} /></div>{error ? <div className="inline-message error" role="alert">{error}</div> : null}<div className="modal-actions"><button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" onClick={() => void save()} disabled={busy}>{busy ? "Saving design…" : "Save ticket design"}</button></div></div></div>;
}

function TicketThemePreview({ event, theme }: { event: AppState["event"]; theme: AppState["event"]["ticketTheme"] }) {
  return <div className="theme-preview" style={{ "--ticket-primary": theme.primaryColour, "--ticket-accent": theme.accentColour } as React.CSSProperties}><header><span>{theme.brandName.slice(0, 2).toUpperCase()}</span><div><strong>{theme.brandName}</strong><small>{theme.ticketTitle}</small></div></header><i /><div className="preview-zone">RED ZONE</div><section><small>{event.name}</small><h3>{event.venue}</h3><div className="preview-qr">QR</div><p>{theme.instructions}</p></section></div>;
}

function CreateEventDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (eventId: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await requestAction({
        action: "createEvent",
        name: form.get("name"), venue: form.get("venue"), status: form.get("status"),
        capacity: Number(form.get("capacity")), entryWindowStart: form.get("entryWindowStart"), entryWindowEnd: form.get("entryWindowEnd"),
      });
      await onCreated(response.event.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Event could not be created");
      setBusy(false);
    }
  }
  return <div className="modal-backdrop"><form className="modal event-form" role="dialog" aria-modal="true" aria-labelledby="create-event-title" onSubmit={submit}><button type="button" className="drawer-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">Top-level event</span><h2 id="create-event-title">Create a new event</h2><p>A separate operational ledger will be created with four starter zones and four gates.</p><div className="form-grid"><label><span>Event name</span><input name="name" required minLength={3} maxLength={120} placeholder="NDP 2027 — Preview 2" /></label><label><span>Venue</span><input name="venue" required minLength={2} maxLength={120} placeholder="The Padang" /></label><label><span>Status</span><select name="status" defaultValue="draft"><option value="draft">Draft</option><option value="live">Live</option><option value="closed">Closed</option></select></label><label><span>Capacity</span><input name="capacity" type="number" required min={1} max={250000} defaultValue={27000} /></label><label><span>Entry starts</span><input name="entryWindowStart" type="time" required defaultValue="16:00" /></label><label><span>Entry ends</span><input name="entryWindowEnd" type="time" required defaultValue="18:00" /></label></div>{error ? <div className="inline-message error" role="alert">{error}</div> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating event…" : "Create event"}</button></div></form></div>;
}

function SetupCard({ eyebrow, title, detail, metric, action, onAction }: { eyebrow: string; title: string; detail: string; metric: string; action: string; onAction: () => void }) { return <article className="panel setup-card"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{detail}</p><strong>{metric}</strong><button className="secondary-button" onClick={onAction}>{action}</button></article>; }

function GateAccessLauncher({ gates, eventId }: { gates: AppState["gates"]; eventId: string }) {
  const [open, setOpen] = useState(false);
  const [gateId, setGateId] = useState(gates[0]?.id ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [accessId, setAccessId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function generate() {
    const response = await requestAction({ action: "createGateAccess", eventId, gateId });
    if (!response.access) return;
    const url = `${window.location.origin}/scanner/${response.access.token}`;
    setLink(url); setAccessId(response.access.id); setCopied(false);
    const qrcode = await import("qrcode");
    setQr(await qrcode.toDataURL(url, { width: 480, margin: 2 }));
  }
  async function revoke() {
    if (accessId) await requestAction({ action: "revokeGateAccess", accessId });
    setOpen(false); setLink(null); setQr(""); setAccessId(null);
  }
  return <article className="panel setup-card"><span className="eyebrow">Scanner access</span><h2>Share a gate scanner</h2><p>Create a restricted 24-hour link for a managed gate device.</p><strong>Expires automatically</strong><button className="secondary-button" onClick={() => setOpen(true)}>Create scanner access</button>{open ? <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><button className="drawer-close" onClick={() => setOpen(false)}>×</button><span className="eyebrow">Gate-only access</span><h2>{link ? "Scanner QR is ready" : "Choose a gate"}</h2>{link ? <><img src={qr} alt="QR code for the restricted scanner link" style={{ width: "min(280px, 100%)", display: "block", margin: "14px auto" }} /><label className="scanner-link"><span>Scanner URL</span><input readOnly value={link} aria-label="Restricted scanner URL" /><button className="secondary-button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? "✓ Copied" : "Copy URL"}</button></label><p>Scan or open this on the gate device. The link expires in 24 hours and can be revoked here.</p><button className="danger-button" onClick={() => void revoke()}>Revoke scanner access</button></> : <><label className="role-switcher"><span>Operating gate</span><select value={gateId} onChange={(event) => setGateId(event.target.value)}>{gates.map((gate) => <option key={gate.id} value={gate.id}>{gate.name}</option>)}</select></label><div className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" onClick={() => void generate()}>Generate QR</button></div></>}</div></div> : null}</article>;
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
  const theme = event.ticketTheme;
  return <div className="drawer-backdrop" role="button" tabIndex={0} aria-label="Close ticket details" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="ticket-drawer"><button className="drawer-close" onClick={onClose} aria-label="Close ticket">×</button><div className="citizen-ticket" style={{ "--ticket-zone": current.zoneColour, "--ticket-primary": theme.primaryColour, "--ticket-accent": theme.accentColour } as React.CSSProperties}><div className="ticket-brand"><div className="brand-mark small" style={{ background: theme.primaryColour }}><span>{theme.brandName.slice(0, 2).toUpperCase()}</span></div><div><strong>{theme.brandName}</strong><span>{theme.ticketTitle}</span></div></div><div className="ticket-theme-accent" /><div className="ticket-zone"><span>{current.zoneName}</span><strong>ZONE</strong></div><div className="ticket-event"><span>{event.name}</span><h2>{event.venue}</h2><div><span>Entry window</span><strong>{event.entryWindowStart}–{event.entryWindowEnd}</strong></div></div><div className="qr-wrap">{qr ? <img src={qr} alt={`QR code for ${current.id}`} /> : <span>Generating QR…</span>}</div><div className="ticket-count"><strong>{current.remainingEntries}</strong><span>of {current.maxEntries} admissions remaining</span></div><p className="ticket-instructions">{theme.instructions}</p><div className="ticket-id">{current.id} · Version {current.version}</div></div><div className="drawer-actions"><a className="wallet-button apple" href={`/api/wallet/apple?ticket=${current.id}`}><span></span><small>Add to</small><strong>Apple Wallet</strong></a><a className="wallet-button google" href={`/api/wallet/google?ticket=${current.id}`}><span>G</span><small>Save to</small><strong>Google Wallet</strong></a><button className="secondary-button full" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? "✓ Link copied" : "Copy ticket link"}</button><button className="danger-button" onClick={() => void regenerate()}>Regenerate lost ticket</button><small className="drawer-help">Regenerating immediately invalidates the previous QR while preserving admissions already used.</small></div></aside></div>;
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
    await requestAction({ action: "import", eventId: state.event.id, rows });
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
