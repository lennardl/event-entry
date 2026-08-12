"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../login.module.css";

export function VerifyForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function verify() {
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json().catch(() => ({ error: "Sign-in failed" }));
    if (!response.ok) {
      setError(data.error ?? "Sign-in failed");
      setSubmitting(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return <div className={styles.form}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <button type="button" onClick={verify} disabled={submitting}>{submitting ? "Signing in…" : "Continue securely"}</button>
  </div>;
}
