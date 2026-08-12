import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in — Event Entry",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.mark}>SG</div>
        <span className={styles.eyebrow}>Operations access</span>
        <h1>Event Entry</h1>
        <p>Use your government email to receive a secure, one-time sign-in code.</p>
        <LoginForm />
      </section>
    </main>
  );
}
