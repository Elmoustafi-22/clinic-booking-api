import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { backend } from "../lib/server/backend.ts";
const key = randomBytes(32).toString("hex");
const original = globalThis.fetch;
const request = (path = "/api/slots", init) =>
  new Request("http://frontend.test" + path, init);
test.beforeEach(() => {
  process.env.API_KEY = key;
  process.env.BACKEND_API_URL = "http://backend.test";
});
test.afterEach(() => {
  globalThis.fetch = original;
  delete process.env.API_KEY;
  delete process.env.BACKEND_API_URL;
});
test("forwards only server credential, exact known queries and an encoded dynamic path", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, "http://backend.test");
    assert.equal(new URL(url).pathname, "/bookings/a%2Fb%3Fx%3D1");
    assert.equal(init.headers.get("X-API-Key"), key);
    assert.equal(init.headers.get("Cookie"), null);
    return Response.json(
      { id: "a/b?x=1" },
      { status: 200, headers: { "X-API-Key": key } },
    );
  };
  const result = await backend(request("/api/bookings/a%2Fb%3Fx%3D1"), {
    bookingId: "a/b?x=1",
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("X-API-Key"), null);
});
test("forwards raw booking JSON and optional empty idempotency key", async () => {
  const raw = ' {"name":" Ada ","email":"ADA@example.com","slot_id":"s0"} ';
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.body, raw);
    assert.equal(init.headers.get("Idempotency-Key"), "");
    assert.equal(init.headers.get("X-API-Key"), key);
    return Response.json({ error: "occupied" }, { status: 409 });
  };
  const response = await backend(
    request("/api/bookings", {
      method: "POST",
      headers: { "Idempotency-Key": "" },
      body: raw,
    }),
    "/bookings",
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "occupied" });
});
test("preserves repeated known queries and drops arbitrary proxy targets", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).search, "?email=a&email=b&cursor=a%2B%2F%3D");
    return Response.json({ error: "bad" }, { status: 400 });
  };
  assert.equal(
    (
      await backend(
        request(
          "/api/bookings?email=a&email=b&cursor=a%2B%2F%3D&url=https://foreign.test",
        ),
        "/bookings",
        ["email", "cursor"],
      )
    ).status,
    400,
  );
});
for (const status of [200, 201, 400, 401, 404, 409, 422, 429])
  test("preserves HTTP " + status + " and JSON envelope", async () => {
    const data = status < 400 ? { id: "booking" } : { error: "domain message" };
    globalThis.fetch = async () =>
      Response.json(data, { status, headers: { "Retry-After": "12" } });
    const result = await backend(request(), "/slots");
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), data);
    assert.equal(
      result.headers.get("Retry-After"),
      status === 429 ? "12" : null,
    );
    assert.equal(result.headers.get("Cache-Control"), "no-store");
  });
test("sanitizes backend 500 without changing its status", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: "private details " + key }, { status: 500 });
  const result = await backend(request(), "/slots");
  assert.equal(result.status, 500);
  assert.deepEqual(await result.json(), {
    error: "Booking service unavailable",
  });
});
test("sanitizes network errors", async () => {
  globalThis.fetch = async () => {
    throw new Error("private connection " + key);
  };
  const result = await backend(request(), "/slots");
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), {
    error: "Booking service unavailable",
  });
});
test("bounds upstream execution and returns a sanitized timeout", async () => {
  const timer = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => timer(fn, 1);
  globalThis.fetch = async (_url, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(new Error("timeout"))),
    );
  try {
    const result = await backend(request(), "/slots");
    assert.equal(result.status, 504);
    assert.deepEqual(await result.json(), {
      error: "Booking service timed out",
    });
  } finally {
    globalThis.setTimeout = timer;
  }
});
test("never follows a backend redirect", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { Location: "https://foreign.test" },
    });
  };
  assert.equal((await backend(request(), "/slots")).status, 502);
});
test("rejects malformed backend JSON safely", async () => {
  globalThis.fetch = async () => new Response("private html", { status: 200 });
  assert.equal((await backend(request(), "/slots")).status, 502);
});
for (const value of [
  undefined,
  "file:///etc/passwd",
  "http://user:password@backend.test",
  "https://backend.test?url=foreign",
])
  test(
    "invalid server configuration is never exposed: " + String(value),
    async () => {
      if (value === undefined) delete process.env.API_KEY;
      else process.env.BACKEND_API_URL = value;
      globalThis.fetch = async () => {
        assert.fail("must not fetch");
      };
      const response = await backend(request(), "/slots");
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Booking service unavailable",
      });
    },
  );
test("rejects control-character IDs before fetch", async () => {
  globalThis.fetch = async () => {
    assert.fail("must not fetch");
  };
  assert.equal(
    (await backend(request(), { bookingId: "bad\u0000id" })).status,
    400,
  );
});
test("sanitizes non-JSON backend failures while preserving their status", async () => {
  globalThis.fetch = async () =>
    new Response("private stack trace", { status: 503 });
  const result = await backend(request(), "/slots");
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), {
    error: "Booking service unavailable",
  });
});
test("invalid credential encoding returns a safe configuration error", async () => {
  process.env.API_KEY = "bad\nheader";
  globalThis.fetch = async () => assert.fail("must not fetch");
  const result = await backend(request(), "/slots");
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), {
    error: "Booking service unavailable",
  });
});
test("a failed request-body read returns JSON without exposing the exception", async () => {
  const req = request("/api/bookings", { method: "POST", body: "{}" });
  Object.defineProperty(req, "text", {
    value: async () => {
      throw new Error("private body failure");
    },
  });
  const result = await backend(req, "/bookings");
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "Invalid request body" });
});
test("checks the public Host rather than Next internal listen hostname", async () => {
  globalThis.fetch = async () =>
    Response.json({ id: "accepted" }, { status: 201 });
  const req = new Request("http://internal.test/api/bookings", {
    method: "POST",
    headers: { Host: "frontend.test", Origin: "http://frontend.test" },
    body: "{}",
  });
  assert.equal((await backend(req, "/bookings")).status, 201);
  const foreign = new Request("http://internal.test/api/bookings", {
    method: "POST",
    headers: { Host: "frontend.test", Origin: "http://foreign.test" },
    body: "{}",
  });
  assert.equal((await backend(foreign, "/bookings")).status, 403);
});
