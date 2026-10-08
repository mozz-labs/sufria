/**
 * The browser's one HTTP client and session store — what the features' calls
 * are built on. Tests build their own with `createHttp` and
 * `memorySessionStore`.
 */
import { API_URL } from "./config.ts";
import { createHttp } from "./http.ts";
import { browserSessionStore } from "./session-store.ts";

export const sessionStore = browserSessionStore();
export const http = createHttp({ baseUrl: API_URL, store: sessionStore });
