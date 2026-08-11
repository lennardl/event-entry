import type { Metadata, Viewport } from "next";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Event Entry",
  description: "Fast, resilient ticketing and gate operations for configurable events.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Event Entry",
    description: "Fast, resilient entry operations",
    type: "website",
    images: [{ url: "/og.png", width: 1733, height: 907, alt: "Event Entry — Fast, resilient entry operations" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Event Entry",
    description: "Fast, resilient entry operations",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#dc162f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
