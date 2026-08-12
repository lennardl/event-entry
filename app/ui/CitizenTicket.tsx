"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import type { EventRecord } from "../../lib/types";
import "./citizen.css";
import "./citizen-extra.css";
import { useQrCode } from "./useQrCode";

type Ticket = { id: string; zoneName: string; zoneColour: string; maxEntries: number; remainingEntries: number; version: number; token: string };
type TicketResponse = { ticket: Ticket; event: EventRecord };
const REFRESH_MS = 10_000;
const load = async (token: string): Promise<TicketResponse> => { const response = await fetch(`/api/ticket/${encodeURIComponent(token)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; };

export function CitizenTicket({ token }: { token: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null); const [event, setEvent] = useState<EventRecord | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const qr = useQrCode(ticket?.token ?? "", 520);
  useEffect(() => { load(token).then((data) => { setTicket(data.ticket); setEvent(data.event); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Ticket could not be opened")); }, [token]);
  useEffect(() => { if (!ticket) return; let previous = ticket.remainingEntries; const refresh = async () => { if (document.visibilityState !== "visible") return; try { const data = await load(token); if (data.ticket.remainingEntries < previous) { const used = previous - data.ticket.remainingEntries; setNotice(`Entry confirmed — ${used} admission${used === 1 ? "" : "s"} used. ${data.ticket.remainingEntries} remaining.`); } previous = data.ticket.remainingEntries; setTicket(data.ticket); setEvent(data.event); } catch { /* Keep the ticket visible during a transient failure. */ } }; const interval = window.setInterval(() => void refresh(), REFRESH_MS); document.addEventListener("visibilitychange", refresh); return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); }; }, [ticket, token]);
  if (error) return <main className="citizen-page"><div className="ticket-error"><strong>Ticket unavailable</strong><span>{error}</span></div></main>;
  if (!ticket || !event) return <main className="citizen-page"><div className="ticket-loading">Opening your event ticket…</div></main>;
  const state = ticket.remainingEntries === 0 ? "All admissions used" : ticket.remainingEntries === ticket.maxEntries ? "Ready for entry" : "Partially used";
  const theme = event.ticketTheme;
  return <main className="citizen-page" style={{ "--ticket-primary": theme.primaryColour, "--ticket-accent": theme.accentColour } as React.CSSProperties}><header><div className="brand-mark ticket-brand-mark"><span>{theme.brandName.slice(0, 2).toUpperCase()}</span></div><div><strong>{theme.brandName}</strong><span>{theme.ticketTitle}</span></div></header>{notice ? <div className="admission-notice" role="status" aria-live="polite">✓ {notice}</div> : null}<div className={`ticket-state ${ticket.remainingEntries ? "ready" : "used"}`}>{state}</div><section className="mobile-ticket" style={{ "--zone": ticket.zoneColour } as React.CSSProperties}><div className="ticket-accent" /><div className="mobile-zone"><span>{ticket.zoneName}</span><strong>ZONE</strong></div><div className="mobile-event"><span>{event.name}</span><h1>{event.venue}</h1><div><span>Entry window</span><strong>{event.entryWindowStart}–{event.entryWindowEnd}</strong></div></div><div className="mobile-qr">{qr ? <img src={qr} alt="Admission QR code" /> : null}</div><div className="mobile-count"><strong>{ticket.remainingEntries}</strong><span>of {ticket.maxEntries} admissions remaining</span></div><p>{theme.instructions}</p><footer>{ticket.id} · v{ticket.version}</footer></section><div className="wallet-unavailable"><strong>Wallet passes are coming soon</strong><span>Your web ticket works offline when saved to your home screen.</span></div></main>;
}
