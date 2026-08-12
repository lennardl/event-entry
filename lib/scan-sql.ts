export const ATOMIC_SCAN_SQL = `
  WITH selected_ticket AS (
    SELECT t.id, t.event_id, t.max_entries, t.used_entries
    FROM tickets t JOIN events e ON e.id = t.event_id
    WHERE t.token = $1 AND t.status = 'active' AND e.status = 'live'
  ), claimed AS (
    INSERT INTO scan_requests (id, fingerprint)
    SELECT $2, $7
    FROM selected_ticket t
    JOIN gates g ON g.id = $6 AND g.event_id = t.event_id
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ), updated AS (
    UPDATE tickets t
    SET used_entries = t.used_entries + $3
    FROM selected_ticket selected, claimed c
    WHERE t.id = selected.id
      AND t.status = 'active'
      AND t.used_entries + $3 <= t.max_entries
    RETURNING t.id, t.used_entries, t.max_entries
  ), logged AS (
    INSERT INTO scans (id, ticket_id, event_id, gate_id, quantity, result, mode, reason, operator, remaining_after)
    SELECT c.id, t.id, t.event_id, g.id, $3,
      CASE WHEN u.id IS NULL THEN 'denied' ELSE 'allowed' END,
      $4,
      CASE WHEN u.id IS NULL THEN 'Not enough admissions remaining' ELSE NULL END,
      $5,
      COALESCE(u.max_entries - u.used_entries, t.max_entries - t.used_entries)
    FROM claimed c
    JOIN selected_ticket t ON true
    JOIN gates g ON g.id = $6 AND g.event_id = t.event_id
    LEFT JOIN updated u ON u.id = t.id
    RETURNING id, ticket_id AS "ticketId", quantity, result, reason, remaining_after AS remaining
  )
  SELECT logged.*, z.name AS "zoneName"
  FROM logged
  JOIN tickets t ON t.id = logged."ticketId"
  JOIN zones z ON z.id = t.zone_id
`;

export const EXISTING_SCAN_SQL = `
  SELECT s.id, s.ticket_id AS "ticketId", s.quantity, s.result, s.reason,
    COALESCE(s.remaining_after, t.max_entries - t.used_entries) AS remaining,
    z.name AS "zoneName"
  FROM scans s
  JOIN scan_requests request ON request.id = s.id
  JOIN tickets t ON t.id = s.ticket_id
  JOIN zones z ON z.id = t.zone_id
  WHERE s.id = $1 AND request.fingerprint = $2
  LIMIT 1
`;
