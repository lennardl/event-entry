"use client";

import { FormEvent, useState } from "react";
import styles from "./login.module.css";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    });
    const data = await response.json().catch(() => ({ error: "Sign-in failed" }));
    if (!response.ok) {
      setError(data.error ?? "Sign-in failed");
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  if (sent) return <div className={styles.success} role="status"><strong>Check your email</strong><span>The link expires in 10 minutes and works once.</span><button type="button" onClick={() => setSent(false)}>Use another address</button></div>;

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="email">Government email</label>
      <input id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@agency.gov.sg" required />
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <button type="submit" disabled={submitting}>{submitting ? "Sending secure link…" : "Email me a sign-in link"}</button>
    </form>
  );
}
