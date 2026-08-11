import type { Metadata } from "next";
import { NdpApp } from "./ui/NdpApp";

export const metadata: Metadata = {
  title: "NDP Entry — Operations",
  description: "Fast, resilient event entry operations for NDP 2027.",
};

export default function Home() {
  return <NdpApp />;
}
