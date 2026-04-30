/**
 * Test E2E mínimo de propagación de AsyncLocalStorage simulando el flow
 * "proxy de Next 16 → server action / route handler".
 *
 * Verificación del riesgo §11.3 del plan de Fase 3 (parada obligatoria
 * tras commit 7). Next 16 proxy.ts corre en Node.js runtime por defecto
 * (proxy.md línea 219, v16.0.0 release notes). Server actions y route
 * handlers también corren en Node. Por arquitectura, AsyncLocalStorage
 * propaga; este test lo confirma empíricamente con un servidor `node:http`
 * real + cadena de `await` simulando el patrón Next.
 *
 * Patrón modelado:
 *   request → proxy(req) {
 *     resolveTenant(host)
 *     runWithTenant(ctx, async () => {
 *       await someMicroTask()
 *       await callServerAction()    // currentTenant() debe ver ctx
 *       return await dbQuery()      // currentTenant() debe ver ctx
 *     })
 *   }
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import { runWithTenant, currentTenant, type TenantContext } from "./context";

let server: Server;
let baseUrl: string;

/**
 * "Server action" simulada: vive en un módulo distinto al proxy y debe
 * poder leer `currentTenant()` aunque se llame muchos await después.
 */
async function fakeServerAction(): Promise<{ slug: string; tenantId: string }> {
  // Cadena de await + setTimeout para forzar microtasks y macrotasks como
  // las que genera el runtime de Next.
  await wait(0);
  await Promise.resolve();
  await wait(5);
  const ctx = currentTenant(); // <- lo crítico: ¿propaga aquí?
  return { slug: ctx.slug, tenantId: ctx.tenantId };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    // Usamos un header custom porque `fetch` reescribe `host` con el
    // destino real del request. En Next 16 real, el proxy lee `host` de
    // verdad; aquí sólo simulamos la cadena de propagación.
    const slug = (req.headers["x-test-slug"] ?? "") as string;
    if (!slug) {
      res.statusCode = 400;
      res.end("no slug");
      return;
    }

    const ctx: TenantContext = {
      tenantId: `tnt_${slug}`,
      slug,
      status: "active",
      features: new Map(),
    };

    // El "proxy" envuelve con runWithTenant.
    runWithTenant(ctx, async () => {
      try {
        const fromAction = await fakeServerAction();
        res.setHeader("content-type", "application/json");
        res.statusCode = 200;
        res.end(JSON.stringify(fromAction));
      } catch (err) {
        res.statusCode = 500;
        res.end((err as Error).message);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (typeof addr === "object" && addr) {
    baseUrl = `http://localhost:${addr.port}`;
  } else {
    throw new Error("no address");
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("AsyncLocalStorage E2E: proxy → server action", () => {
  it("ctx envuelto por proxy es visible dentro de server action async", async () => {
    const r = await fetch(`${baseUrl}/`, {
      headers: { "x-test-slug": "acme" },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { slug: string; tenantId: string };
    expect(body.slug).toBe("acme");
    expect(body.tenantId).toBe("tnt_acme");
  });

  it("requests concurrentes con tenants distintos no se contaminan", async () => {
    const N = 8;
    const tenants = ["acme", "umbrella", "globex", "initech"];
    const requests: Promise<{ slug: string; expected: string }>[] = [];
    for (let i = 0; i < N; i++) {
      const expected = tenants[i % tenants.length]!;
      requests.push(
        (async () => {
          const r = await fetch(`${baseUrl}/`, {
            headers: { "x-test-slug": expected },
          });
          const body = (await r.json()) as { slug: string };
          return { slug: body.slug, expected };
        })(),
      );
    }
    const results = await Promise.all(requests);
    for (const { slug, expected } of results) {
      expect(slug).toBe(expected);
    }
  });

  it("currentTenant() lanza si el handler se llama sin runWithTenant en un servidor independiente", async () => {
    const noWrapServer = createServer((_req, res) => {
      try {
        currentTenant();
        res.statusCode = 200;
        res.end("ok");
      } catch (err) {
        res.statusCode = 500;
        res.end((err as Error).message);
      }
    });
    await new Promise<void>((resolve) => noWrapServer.listen(0, resolve));
    const addr = noWrapServer.address();
    const url =
      typeof addr === "object" && addr ? `http://localhost:${addr.port}/` : "";

    const r = await fetch(url);
    expect(r.status).toBe(500);
    const body = await r.text();
    expect(body).toMatch(/No hay tenant/);

    await new Promise<void>((resolve, reject) =>
      noWrapServer.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
