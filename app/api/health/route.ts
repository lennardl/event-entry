import { performance } from "node:perf_hooks";
import { authenticatedRole } from "../../../lib/auth";
import { getSql } from "../../../db";

const DATABASE_TIMEOUT_MS = 5_000;
const DEGRADED_AFTER_MS = 1_000;

export async function GET(request: Request) {
  if (!authenticatedRole(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = getSql()`SELECT now() AS checked_at`;
    const rows = await Promise.race([
      query,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Database health check timed out")), DATABASE_TIMEOUT_MS); }),
    ]);
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
    const row = (rows as unknown as Array<{ checked_at?: Date | string }>)[0];
    return Response.json({
      status: latencyMs >= DEGRADED_AFTER_MS ? "degraded" : "connected",
      checkedAt: row?.checked_at ? new Date(row.checked_at).toISOString() : new Date().toISOString(),
      latencyMs,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("Database health check failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ status: "unavailable", checkedAt: new Date().toISOString(), latencyMs: null }, {
      status: 503,
      headers: { "cache-control": "private, no-store" },
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
