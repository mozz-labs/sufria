"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "../../../shared/api/session-store.ts";
import { authApi } from "../api/auth-api.ts";
import { useSession } from "../hooks/use-session.ts";
import { loginPathFor } from "../lib/session.ts";

type Props = {
  /** The pages, given the session and a logout that ends on the login screen. */
  children: (session: Session, logout: () => Promise<void>) => ReactNode;
};

/**
 * Every page behind login (brief I §4, I-3): nothing until the session is
 * read; with none — or once a 401 the refresh could not cure ends it, on any
 * page — the login screen, coming back to this page after it.
 */
export function SessionGate({ children }: Props) {
  const router = useRouter();
  const session = useSession();
  // A logout goes to the login screen itself, not back here after it.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (session !== null || leaving) return;
    router.replace(
      loginPathFor(window.location.pathname + window.location.search),
    );
  }, [router, session, leaving]);

  const logout = useCallback(async () => {
    setLeaving(true);
    await authApi.logout();
    router.replace("/login");
  }, [router]);

  if (!session) return null;
  return children(session, logout);
}
