import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { HttpError, wrapHttpErrors } from "./http-error";

function makeReq() {
  return new NextRequest("http://test.localhost:3000/api/x", {
    headers: { host: "test.localhost:3000" },
  });
}

describe("HttpError + wrapHttpErrors", () => {
  it("HttpError name y mensaje", () => {
    const err = new HttpError(402, { error: "x", k: "y" });
    expect(err.name).toBe("HttpError");
    expect(err.status).toBe(402);
    expect(err.body).toEqual({ error: "x", k: "y" });
    expect(err.message).toContain("402");
  });

  it("wrapHttpErrors devuelve handler intacto si no lanza", async () => {
    const handler = wrapHttpErrors(async () => new Response("ok", { status: 200 }));
    const res = await handler(makeReq());
    expect(res.status).toBe(200);
  });

  it("wrapHttpErrors captura HttpError y devuelve body+status", async () => {
    const handler = wrapHttpErrors(async () => {
      throw new HttpError(402, { error: "limit_reached", current: 50, max: 50 });
    });
    const res = await handler(makeReq());
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "limit_reached",
      current: 50,
      max: 50,
    });
  });

  it("wrapHttpErrors devuelve 500 internal para errores no-HttpError", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = wrapHttpErrors(async () => {
      throw new Error("boom");
    });
    const res = await handler(makeReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    consoleErr.mockRestore();
  });
});

import { vi } from "vitest";
