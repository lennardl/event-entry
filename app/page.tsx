import type { Metadata } from "next";
import { NdpApp } from "./ui/NdpApp";

export const metadata: Metadata = {
  title: "Event Entry — Operations",
  description: "Fast, resilient ticketing and gate operations for configurable events.",
};

export default function Home() {
  return <NdpApp />;
}
