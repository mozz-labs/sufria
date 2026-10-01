/**
 * The browser's one API client and session store — what the pages use.
 * Tests build their own with `createApi` and `memorySessionStore`.
 */
import { createApi } from "./api.ts";
import { API_URL } from "./config.ts";
import { browserSessionStore } from "./session.ts";

export const sessionStore = browserSessionStore();
export const api = createApi({ baseUrl: API_URL, store: sessionStore });
