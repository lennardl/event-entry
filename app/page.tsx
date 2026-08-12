import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { authenticatedRole } from "../lib/auth";
import { getState } from "../lib/store";
import { NdpApp } from "./ui/NdpApp";

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
    initialState = await getState(event);
    const requestHeaders = await headers();
    initialState.role = authenticatedRole(new Request("http://localhost", { headers: requestHeaders })) ?? "Command Centre Viewer";
  } catch (error) {
    console.error("Initial operations render failed", error);
    initialError = "Could not load operations data";
  }
  return <NdpApp initialState={initialState} initialError={initialError} />;
}
