"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../hooks/use-session.ts";
import { AFTER_LOGIN } from "../lib/session.ts";

/** `/` (brief I §2.1): the orders with a session in this tab, login without. */
export function RootRedirect() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    // `undefined`: not read yet — the server render has no sessionStorage.
    if (session !== undefined) router.replace(session ? AFTER_LOGIN : "/login");
  }, [router, session]);

  return null;
}
