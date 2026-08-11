export type Role = "Super Admin" | "Admin" | "Gate Supervisor" | "Command Centre Viewer";

export type EventRecord = {
  id: string;
  name: string;
  venue: string;
  status: string;
  capacity: number;
  entryWindowStart: string;
  entryWindowEnd: string;
};

export type ZoneRecord = {
  id: string;
  name: string;
  colour: string;
  capacity: number;
};

export type GateRecord = { id: string; name: string };

export type TicketRecord = {
  id: string;
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
  event: EventRecord;
  zones: ZoneRecord[];
  gates: GateRecord[];
  tickets: TicketRecord[];
  scans: ScanRecord[];
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
