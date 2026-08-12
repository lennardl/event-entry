"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({ error: "Sign-in failed" }));
    setSubmitting(false);
    if (!response.ok) return setError(data.error ?? "Sign-in failed");
    setCodeSent(true);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code: String(form.get("code") ?? "").replace(/\D/g, "") }),
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

  if (codeSent) return <form className={styles.form} onSubmit={verifyCode}>
    <div className={styles.codeIntro} role="status"><strong>Check your email</strong><span>Enter the 8-digit code sent to <b>{email}</b>. It expires in 10 minutes.</span></div>
    <label htmlFor="code">Sign-in code</label>
    <input className={styles.codeInput} id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} placeholder="00000000" required />
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <button type="submit" disabled={submitting}>{submitting ? "Checking code…" : "Sign in"}</button>
    <button className={styles.textButton} type="button" onClick={() => { setCodeSent(false); setError(null); }}>Use another address</button>
  </form>;

  return <form className={styles.form} onSubmit={requestCode}>
    <label htmlFor="email">Government email</label>
    <input id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@agency.gov.sg" value={email} onChange={(event) => setEmail(event.target.value)} required />
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <button type="submit" disabled={submitting}>{submitting ? "Sending code…" : "Email me a sign-in code"}</button>
  </form>;
}
