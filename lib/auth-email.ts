import type { Role } from "./types";

export function normaliseEmail(value: string) {
  return value.trim().toLowerCase();
}

function configuredList(name: string) {
  return new Set((process.env[name] ?? "").split(",").map(normaliseEmail).filter(Boolean));
}

export function isAllowedGovernmentEmail(value: string) {
  const email = normaliseEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const allowed = (process.env.AUTH_ALLOWED_EMAIL_DOMAINS ?? "gov.sg").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return allowed.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}

export function roleForEmail(value: string): Role {
  const email = normaliseEmail(value);
  if (configuredList("AUTH_SUPER_ADMIN_EMAILS").has(email)) return "Super Admin";
  if (configuredList("AUTH_GATE_SUPERVISOR_EMAILS").has(email)) return "Gate Supervisor";
  if (configuredList("AUTH_VIEWER_EMAILS").has(email)) return "Command Centre Viewer";
  return "Admin";
}
