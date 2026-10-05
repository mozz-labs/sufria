"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "../../../shared/api/session-store.ts";
import { authApi } from "../api/auth-api.ts";
import { useSession } from "../hooks/use-session.ts";

type Props = {
  /** The page, given the session and a logout that ends on the login screen. */
  children: (session: Session, logout: () => Promise<void>) => ReactNode;
};

/**
 * A page behind login: nothing until the session is read, the login screen
 * when there is none (G-3).
 */
export function SessionGate({ children }: Props) {
  const router = useRouter();
  const session = useSession();

  const toLogin = useCallback(() => router.replace("/"), [router]);

  useEffect(() => {
    if (session === null) toLogin();
  }, [session, toLogin]);

  const logout = useCallback(async () => {
    await authApi.logout();
    toLogin();
  }, [toLogin]);

  if (!session) return null;
  return children(session, logout);
}
