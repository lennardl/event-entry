"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { EventRecord } from "../../lib/types";
import "./citizen.css";
import "./citizen-extra.css";
import "./citizen-polish.css";
import { useQrCode } from "./useQrCode";

type Ticket = { id: string; zoneName: string; zoneColour: string; maxEntries: number; remainingEntries: number; version: number; token: string };
type TicketResponse = { ticket: Ticket; event: EventRecord };
const REFRESH_MS = 5_000;
const load = async (token: string): Promise<TicketResponse> => { const response = await fetch(`/api/ticket/${encodeURIComponent(token)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; };

export function CitizenTicket({ token }: { token: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null); const [event, setEvent] = useState<EventRecord | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState<{ remaining: number } | null>(null);
  const remainingRef = useRef<number | null>(null); const refreshingRef = useRef(false);
  const qr = useQrCode(ticket?.token ?? "", 520);
  useEffect(() => { load(token).then((data) => { remainingRef.current = data.ticket.remainingEntries; setTicket(data.ticket); setEvent(data.event); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Ticket could not be opened")); }, [token]);
  useEffect(() => { const refresh = async () => { if (document.visibilityState !== "visible" || refreshingRef.current || remainingRef.current === null) return; refreshingRef.current = true; try { const data = await load(token); if (data.ticket.remainingEntries < remainingRef.current) setNotice({ remaining: data.ticket.remainingEntries }); remainingRef.current = data.ticket.remainingEntries; setTicket(data.ticket); setEvent(data.event); } catch { /* Keep the ticket visible during a transient failure. */ } finally { refreshingRef.current = false; } }; const onVisibilityChange = () => { if (document.visibilityState === "visible") void refresh(); }; const interval = window.setInterval(() => void refresh(), REFRESH_MS); document.addEventListener("visibilitychange", onVisibilityChange); return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibilityChange); }; }, [token]);
  if (error) return <main className="citizen-page"><div className="ticket-error"><strong>Ticket unavailable</strong><span>{error}</span></div></main>;
  if (!ticket || !event) return <main className="citizen-page"><div className="ticket-loading">Opening your event ticket…</div></main>;
  const state = ticket.remainingEntries === 0 ? "Ticket used" : ticket.remainingEntries === ticket.maxEntries ? "Ready" : `${ticket.maxEntries - ticket.remainingEntries} used · ${ticket.remainingEntries} left`;
  const theme = event.ticketTheme;
  return <main className="citizen-page" style={{ "--ticket-primary": theme.primaryColour, "--ticket-accent": theme.accentColour } as React.CSSProperties}><header>{theme.logoDataUrl ? <img className="ticket-logo" src={theme.logoDataUrl} alt={`${theme.brandName} logo`} /> : <div className="brand-mark ticket-brand-mark"><span>{theme.brandName.slice(0, 2).toUpperCase()}</span></div>}<div><strong>{theme.brandName}</strong><span>{theme.ticketTitle}</span></div></header>{notice ? <div className="admission-notice" role="status" aria-live="polite"><span aria-hidden="true">✓</span><div><strong>Entry confirmed</strong><span>{notice.remaining ? `${notice.remaining} left` : "All used"}</span></div></div> : null}<div className={`ticket-state ${ticket.remainingEntries ? "ready" : "used"}`}>{state}</div><section className="mobile-ticket" style={{ "--zone": ticket.zoneColour } as React.CSSProperties}><div className="ticket-accent" /><div className="mobile-zone"><span>{ticket.zoneName}</span><strong>ZONE</strong></div><div className="mobile-event"><span>{event.name}</span><h1>{event.venue}</h1><div><span>Entry</span><strong>{event.entryWindowStart}–{event.entryWindowEnd}</strong></div></div><div className="mobile-qr">{qr ? <img src={qr} alt="Admission QR code" /> : null}</div><div className="mobile-count"><strong>{ticket.remainingEntries}</strong><span>of {ticket.maxEntries} left</span></div><p>{theme.instructions}</p>{theme.supportContact ? <p>Help: {theme.supportContact}</p> : null}{theme.terms ? <details><summary>Ticket terms</summary><p>{theme.terms}</p></details> : null}<footer>{ticket.id} · v{ticket.version}</footer></section><div className="wallet-unavailable"><strong>Wallet passes unavailable</strong><span>Use this QR for entry.</span></div></main>;
}
