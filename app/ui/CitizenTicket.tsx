"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import type { EventRecord, TicketRecord } from "../../lib/types";
import "./citizen.css";

export function CitizenTicket({ token }: { token: string }) {
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      fetch(`/api/ticket/${encodeURIComponent(token)}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }),
      import("qrcode"),
    ]).then(async ([data, qrcode]) => {
      setTicket(data.ticket); setEvent(data.event);
      setQr(await qrcode.toDataURL(data.ticket.token, { width: 520, margin: 2, color: { dark: "#17213A", light: "#FFFFFF" } }));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Ticket could not be opened"));
  }, [token]);
  if (error) return <main className="citizen-page"><div className="ticket-error"><strong>Ticket unavailable</strong><span>{error}</span></div></main>;
  if (!ticket || !event) return <main className="citizen-page"><div className="ticket-loading">Opening your NDP ticket…</div></main>;
  return <main className="citizen-page"><header><div className="brand-mark"><span>SG</span><small>60+</small></div><div><strong>NDP 2027</strong><span>Official admission ticket</span></div><button aria-label="Change language">EN⌄</button></header><section className="mobile-ticket" style={{ "--zone": ticket.zoneColour } as React.CSSProperties}><div className="mobile-zone"><span>{ticket.zoneName}</span><strong>ZONE</strong></div><div className="mobile-event"><span>{event.name}</span><h1>{event.venue}</h1><div><span>Entry window</span><strong>{event.entryWindowStart}–{event.entryWindowEnd}</strong></div></div><div className="mobile-qr">{qr ? <img src={qr} alt="Admission QR code" /> : null}</div><div className="mobile-count"><strong>{ticket.remainingEntries}</strong><span>of {ticket.maxEntries} admissions remaining</span></div><p>Present this QR at any entry gate. If your assigned zone is elsewhere, staff will direct you after entry.</p><footer>{ticket.id} · v{ticket.version}</footer></section><div className="wallet-row"><a href={`/api/wallet/apple?ticket=${ticket.id}`}><b></b><span>Add to<br/><strong>Apple Wallet</strong></span></a><a href={`/api/wallet/google?ticket=${ticket.id}`}><b>G</b><span>Save to<br/><strong>Google Wallet</strong></span></a></div><section className="citizen-info"><h2>Before you arrive</h2><div><span>1</span><p><strong>Keep this ticket available</strong><br/>Add it to your phone wallet for access without network.</p></div><div><span>2</span><p><strong>Arrive between {event.entryWindowStart} and {event.entryWindowEnd}</strong><br/>You may enter through any gate.</p></div><div><span>3</span><p><strong>Entering separately?</strong><br/>This QR can be used again until all {ticket.maxEntries} admissions are consumed.</p></div></section></main>;
}
