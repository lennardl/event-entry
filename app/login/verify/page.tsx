import type { Metadata } from "next";
import Link from "next/link";
import { VerifyForm } from "./VerifyForm";
import styles from "../login.module.css";

export const metadata: Metadata = { title: "Verify sign-in — Event Entry", robots: { index: false, follow: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const validShape = /^[A-Za-z0-9_-]{43}$/.test(token);
  return <main className={styles.page}><section className={styles.card}>
    <div className={styles.mark}>SG</div>
    <span className={styles.eyebrow}>Operations access</span>
    <h1>{validShape ? "Confirm sign-in" : "Invalid sign-in link"}</h1>
    <p>{validShape ? "Continue to securely open the Event Entry operations console." : "This link is incomplete. Request a new sign-in email to continue."}</p>
    {validShape ? <VerifyForm token={token} /> : <Link href="/login">Return to sign in</Link>}
  </section></main>;
}
