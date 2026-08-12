import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { authorizeRequest } from "../lib/auth-authorization";
import { getState } from "../lib/store";
import { EventOperationsApp } from "./ui/EventOperationsApp";

export const metadata: Metadata = {
  title: "Event Entry — Operations",
  description: "Fast, resilient ticketing and gate operations for configurable events.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  await connection();
  const { event } = await searchParams;
  let initialState = null;
  let initialError = null;
  try {
    const requestHeaders = await headers();
    const identity = await authorizeRequest(new Request("http://localhost", { headers: requestHeaders }));
    if (!identity) throw new Error("Unauthorized session");
    initialState = await getState(event);
    initialState.role = identity.role;
  } catch (error) {
    console.error("Initial operations render failed", error);
    initialError = "Could not load operations data";
  }
  return <EventOperationsApp initialState={initialState} initialError={initialError} />;
}
