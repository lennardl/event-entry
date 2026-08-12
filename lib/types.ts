export type Role = "Super Admin" | "Admin" | "Gate Supervisor" | "Command Centre Viewer";

export type TicketTheme = {
  brandName: string;
  ticketTitle: string;
  instructions: string;
  primaryColour: string;
  accentColour: string;
  logoDataUrl: string;
  supportContact: string;
  terms: string;
};

export type TicketPolicy = {
  allowETickets: boolean;
  allowPhysical: boolean;
  allowGroups: boolean;
  maxGroupSize: number;
  allowRegeneration: boolean;
};

export type EventRecord = {
  id: string;
  name: string;
  venue: string;
  status: string;
  version: number;
  deletedAt: string | null;
  capacity: number;
  startDate: string;
  endDate: string;
  timeZone: string;
  doorsOpen: string;
  eventEnd: string;
  entryWindowStart: string;
  entryWindowEnd: string;
  ticketTheme: TicketTheme;
  ticketPolicy: TicketPolicy;
};

export type EventSummary = EventRecord & {
  ticketCount: number;
  admitted: number;
};

export type ZoneRecord = {
  id: string;
  name: string;
  colour: string;
  capacity: number;
};

export type GateRecord = { id: string; name: string };
export type GateAccessRecord = { id: string; gateId: string; gateName: string; label: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; createdAt: string };
export type AuditRecord = { id: string; action: string; actor: string; subjectId: string; detail: string; createdAt: string };

export type TicketRecord = {
  id: string;
  eventId: string;
  maskedNric: string;
  mobile: string;
  zoneId: string;
  zoneName: string;
  zoneColour: string;
  format: "e-ticket" | "physical";
  maxEntries: number;
  usedEntries: number;
  remainingEntries: number;
  version: number;
  token: string;
  status: string;
};

export type ScanRecord = {
  id: string;
  ticketId: string;
  gateId: string;
  gateName: string;
  quantity: number;
  result: string;
  mode: string;
  reason: string | null;
  operator: string;
  createdAt: string;
};

export type AppState = {
  role?: Role;
  event: EventRecord;
  events: EventSummary[];
  zones: ZoneRecord[];
  gates: GateRecord[];
  gateAccessLinks: GateAccessRecord[];
  auditEvents: AuditRecord[];
  tickets: TicketRecord[];
  scans: ScanRecord[];
  readiness: {
    ready: boolean;
    progress: number;
    nextAction: string;
    checks: Array<{ id: string; label: string; ok: boolean; detail: string; level: "blocker" | "warning" }>;
  };
  metrics: {
    allocated: number;
    admitted: number;
    remaining: number;
    issuedBundles: number;
    eTicketAdmissions: number;
    physicalAdmissions: number;
    manualAdmissions: number;
    offlineAdmissions: number;
    deniedAttempts: number;
    entryRate: number;
  };
};
