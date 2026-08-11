import { NextRequest, NextResponse } from "next/server";
import { isAuthenticatedRequest } from "./lib/auth";

export function proxy(request: NextRequest) {
  if (isAuthenticatedRequest(request)) return NextResponse.next();
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/"],
};
