import { authenticatedIdentity } from "./auth";
import { activeUser } from "./auth-users";

export async function authorizeRequest(request: Request) {
  const identity = authenticatedIdentity(request); if (!identity) return null;
  if (!identity.email || identity.sessionVersion === null) return identity;
  const user = await activeUser(identity.email, identity.sessionVersion);
  return user ? { role: user.role, email: user.email, sessionVersion: user.sessionVersion } : null;
}
