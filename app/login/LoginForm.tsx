"use client";

import { FormEvent, useState } from "react";
import styles from "./login.module.css";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKey: form.get("accessKey") }),
    });
    const data = await response.json().catch(() => ({ error: "Sign-in failed" }));
    if (!response.ok) {
      setError(data.error ?? "Sign-in failed");
      setSubmitting(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="accessKey">Access key</label>
      <input id="accessKey" name="accessKey" type="password" autoComplete="current-password" required />
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
