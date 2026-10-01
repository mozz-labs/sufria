/**
 * CORS — brief G §3 (G-2) and §4 test 5: the dashboard's origin is allowed,
 * a foreign one is not.
 *
 * Real HTTP through the real AppModule, with the very `corsOptions()` main.ts
 * passes to `enableCors`. "Refused" is asserted the way a browser decides it:
 * a preflight and a request from a foreign origin come back without
 * `Access-Control-Allow-Origin`, so the browser never hands the reply to the
 * page.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import { DEFAULT_DASHBOARD_WEB_ORIGIN, corsOptions } from "../src/cors.js";

const DASHBOARD = "http://localhost:3000";
const FOREIGN = "http://evil.example";

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  // The default, as a development machine without DASHBOARD_WEB_ORIGIN runs.
  app.enableCors(corsOptions(undefined));
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

const preflight = (origin: string): Promise<Response> =>
  fetch(`${baseUrl}/orders?tab=active`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,x-restaurant-id",
    },
  });

describe("CORS", () => {
  it("the default origin is the local dashboard", () => {
    expect(DEFAULT_DASHBOARD_WEB_ORIGIN).toBe(DASHBOARD);
    expect(corsOptions(undefined).origin).toEqual([DASHBOARD]);
  });

  it("DASHBOARD_WEB_ORIGIN sets it, comma-separated for more than one", () => {
    expect(
      corsOptions("https://app.sufria.example, http://localhost:3000").origin,
    ).toEqual(["https://app.sufria.example", "http://localhost:3000"]);
  });

  it("the dashboard's origin: the preflight allows it, with the two headers", async () => {
    const res = await preflight(DASHBOARD);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "x-restaurant-id",
    );
  });

  it("the dashboard's origin: a plain request carries the header", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: DASHBOARD },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
  });

  it("a foreign origin: the preflight carries no Allow-Origin at all", async () => {
    const res = await preflight(FOREIGN);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a foreign origin: a plain request carries no Allow-Origin either", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: FOREIGN },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
