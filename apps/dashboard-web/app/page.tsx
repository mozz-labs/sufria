"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DEMO_CREDENTIALS, RESTAURANT } from "../lib/mock";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailed(false);
    setBusy(true);

    // محاكاة نداء الشبكة. بينستبدل بـPOST /auth/login عند S0-08.
    window.setTimeout(() => {
      const ok =
        user.trim().toLowerCase() === DEMO_CREDENTIALS.user &&
        pass === DEMO_CREDENTIALS.pass;
      if (ok) {
        router.push("/dashboard");
      } else {
        // نص واحد لكل أسباب الفشل — منعا لتعداد الحسابات.
        setFailed(true);
        setBusy(false);
      }
    }, 550);
  }

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">
            ش
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>{RESTAURANT.name}</span>
            <span className={styles.brandSub}>{RESTAURANT.branch}</span>
          </div>
        </div>

        <h1 className={styles.title}>تسجيل الدخول</h1>
        <p className={styles.subtitle}>
          ادخل ببيانات الموظف للوصول إلى لوحة الطلبات.
        </p>

        <form onSubmit={onSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="user">
              البريد الإلكتروني أو رقم الهاتف
            </label>
            <div className={styles.inputWrap}>
              <input
                id="user"
                className={`${styles.input} ${failed ? styles.invalid : ""}`}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="username"
                dir="ltr"
                placeholder="name@example.com"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="pass">
              كلمة المرور
            </label>
            <div className={styles.inputWrap}>
              <input
                id="pass"
                type={show ? "text" : "password"}
                className={`${styles.input} ${styles.hasPassword} ${
                  failed ? styles.invalid : ""
                }`}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                dir="ltr"
                aria-invalid={failed}
                aria-describedby={failed ? "loginError" : undefined}
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              >
                {show ? "إخفاء" : "إظهار"}
              </button>
            </div>

            {failed && (
              <p className={styles.error} id="loginError" role="alert">
                <span aria-hidden="true">✕</span>
                بيانات الدخول غير صحيحة
              </p>
            )}

            <a className={styles.forgot} href="#">
              نسيت كلمة المرور؟
            </a>
          </div>

          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? "جارٍ التحقق…" : "دخول"}
          </button>
        </form>

        <div className={styles.hint}>
          <span className={styles.hintTitle}>بيانات العرض التجريبي</span>
          المستخدم: <code>{DEMO_CREDENTIALS.user}</code>
          <br />
          كلمة المرور: <code>{DEMO_CREDENTIALS.pass}</code>
        </div>
      </main>
    </div>
  );
}
