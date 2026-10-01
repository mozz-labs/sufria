"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_UI_AR } from "@sufria/shared";
import { api, sessionStore } from "../lib/client.ts";
import { sessionFromLogin } from "../lib/session.ts";
import { useSession } from "../lib/use-session.ts";
import { BrandMark } from "./brand-mark.tsx";
import styles from "./login.module.css";

const T = DASHBOARD_UI_AR;

/** Brief G §3 (G-3): two fields and a button. */
export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const session = useSession();

  // Already logged in in this tab: straight to the orders.
  useEffect(() => {
    if (session) router.replace("/orders");
  }, [router, session]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await api.login({
      phoneOrEmail: identifier.trim(),
      password,
    });
    const session = res.ok ? sessionFromLogin(res.value) : null;
    if (session) {
      sessionStore.set(session);
      router.replace("/orders");
      return;
    }
    // A 401 is the API's one answer for every wrong credential. Anything else
    // (no network, no restaurant on the account) is not the user's typing.
    setError(
      !res.ok && res.error.kind === "unauthorized"
        ? T.login.failed
        : T.errors.stepFailed,
    );
    setBusy(false);
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>
          <BrandMark />
          {T.brand}
        </h1>

        <label className={styles.field}>
          <span className={styles.label}>{T.login.identifier}</span>
          <input
            className={styles.input}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            dir="ltr"
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{T.login.password}</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
            required
            aria-invalid={error !== null}
            aria-describedby={error ? "login-error" : undefined}
          />
        </label>

        {error && (
          <p id="login-error" className={styles.error} role="alert">
            {error}
          </p>
        )}

        {/* Disabled while sending, its text unchanged (G-4, same rule). */}
        <button className={styles.submit} type="submit" disabled={busy}>
          {T.login.submit}
        </button>
      </form>
    </main>
  );
}
