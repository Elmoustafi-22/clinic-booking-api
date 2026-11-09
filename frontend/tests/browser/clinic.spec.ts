import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
const slot = (id: string, provider = "Dr Ade") => ({
  id,
  provider,
  start: "2099-12-10T09:00:00Z",
  end: "2099-12-10T09:30:00Z",
});
const inventory = [
  slot("s0"),
  slot("s1", "Dr Amaka"),
  ...Array.from({ length: 22 }, (_, i) => slot("s" + (i + 2))),
  {
    ...slot("past"),
    start: "2020-01-01T09:00:00Z",
    end: "2020-01-01T09:30:00Z",
  },
];
const body = { slot_id: "s0", name: "Ada Obi", email: "ada@example.com" };
async function reset(request: APIRequestContext) {
  const response = await request.post("http://127.0.0.1:3101/reset", {
    headers: { "X-API-Key": process.env.CLINICSLOT_TEST_KEY! },
    data: { slots: inventory },
  });
  expect(response.status()).toBe(200);
}
async function form(page: Page) {
  await page.goto("/book?slot_id=s0");
  await page.getByLabel("Full name").fill("Ada Obi");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("ada@example.com");
}
test.beforeEach(async ({ request }) => reset(request));

test("lists slots, uses exact server-side provider filtering and disables started/booked slots", async ({
  page,
  request,
}) => {
  const occupied = await request.post("/api/bookings", { data: body });
  expect(occupied.status()).toBe(201);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find an appointment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unavailable", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Appointment has started", exact: true }),
  ).toHaveCount(1);
  const filtered = page.waitForResponse((r) =>
    r.url().includes("/api/slots?provider=Dr+Amaka"),
  );
  await page
    .getByLabel("Healthcare provider")
    .selectOption({ label: "Dr Amaka" });
  await filtered;
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("Dr Amaka");
});
test("shows a designed empty state", async ({ page }) => {
  await page.route("**/api/slots", (r) => r.fulfill({ json: { slots: [] } }));
  await page.goto("/");
  await expect(page.getByText("No appointments to show")).toBeVisible();
});
test("shows a recoverable listing error", async ({ page }) => {
  await page.route("**/api/slots", (r) =>
    r.fulfill({ status: 502, json: { error: "Unavailable" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
test("validates required fields and email without sending a booking", async ({
  page,
}) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/bookings") && r.method() === "POST") calls++;
  });
  await page.goto("/book?slot_id=s0");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await page.getByLabel("Full name").fill("Ada");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("invalid");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  expect(calls).toBe(0);
});
test("books through Next and Nest/PostgreSQL, displays complete confirmation and copies its ID", async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await form(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re booked in." }),
  ).toBeVisible();
  await expect(
    page.getByText("ada@example.com", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  const id = (await page.locator("code").textContent())!;
  await page.getByRole("button", { name: "Copy booking ID" }).click();
  await expect(page.getByText("Booking ID copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  const saved = await request.get("/api/bookings/" + encodeURIComponent(id));
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({
    ...body,
    id,
    status: "confirmed",
  });
});
test("prevents repeat clicks while booking is pending", async ({ page }) => {
  let count = 0;
  await page.route("**/api/bookings", async (route) => {
    count++;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 201,
      json: {
        ...body,
        id: "pending",
        status: "confirmed",
        created_at: new Date().toISOString(),
      },
    });
  });
  await form(page);
  await page.getByRole("button", { name: "Confirm booking" }).dblclick();
  await expect(
    page.getByRole("heading", { name: "You’re booked in." }),
  ).toBeVisible();
  expect(count).toBe(1);
});
for (const status of [400, 404, 409, 422, 429])
  test("booking handles HTTP " + status, async ({ page }) => {
    await page.route("**/api/bookings", (r) =>
      r.fulfill({
        status,
        headers: status === 429 ? { "Retry-After": "17" } : {},
        json: {
          error: status === 400 ? "slot has already started" : "failure",
        },
      }),
    );
    await form(page);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    if (status === 429)
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "17 seconds",
      );
    if (status === 409)
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "no longer available",
      );
  });
test("reuses an intent key after an uncertain network response and rotates it when details change", async ({
  page,
}) => {
  const keys: string[] = [],
    bodies: unknown[] = [];
  await page.route("**/api/bookings", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 502, json: { error: "Unavailable" } });
  });
  await form(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  }
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(bodies[1]).toEqual(bodies[0]);
  await page.getByLabel("Full name").fill("Ada Changed");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(keys[2]).not.toBe(keys[0]);
});
test("finds a persisted booking and cancels it through the confirmation dialog", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/bookings", { data: body });
  const booking = await created.json();
  await page.goto("/find-booking");
  await page.getByLabel("Booking ID", { exact: true }).fill(booking.id);
  await page.getByRole("button", { name: "Find booking", exact: true }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep appointment" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  const slots = await (await request.get("/api/slots")).json();
  expect(slots.slots.find((s: { id: string }) => s.id === "s0").available).toBe(
    true,
  );
});
test("missing booking has a clear error", async ({ page }) => {
  await page.goto("/find-booking");
  await page.getByLabel("Booking ID", { exact: true }).fill("missing");
  await page.getByRole("button", { name: "Find booking", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "couldn’t find a booking",
  );
});
for (const status of [404, 409, 500])
  test("cancellation handles HTTP " + status, async ({ page, request }) => {
    const booking = await (
      await request.post("/api/bookings", { data: body })
    ).json();
    await page.goto("/find-booking");
    await page.getByLabel("Booking ID", { exact: true }).fill(booking.id);
    await page
      .getByRole("button", { name: "Find booking", exact: true })
      .click();
    await page.route("**/api/bookings/" + booking.id, async (route) => {
      if (route.request().method() === "DELETE")
        await route.fulfill({ status, json: { error: "failure" } });
      else await route.continue();
    });
    await page
      .getByRole("button", { name: "Cancel booking", exact: true })
      .click();
    await page.getByRole("button", { name: "Yes, cancel booking" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  });
test("history follows returned cursor, deduplicates pages and includes cancelled bookings", async ({
  page,
}) => {
  const booking = {
    ...body,
    id: "history-1",
    status: "cancelled",
    created_at: "2030-01-01T00:00:00Z",
  };
  const requests: string[] = [];
  await page.route("**/api/bookings?**", async (route) => {
    requests.push(route.request().url());
    const more = new URL(route.request().url()).searchParams.has("cursor");
    await route.fulfill({
      json: {
        bookings: more
          ? [booking, { ...booking, id: "history-2", status: "confirmed" }]
          : [booking],
        next_cursor: more ? null : "opaque+/cursor=",
      },
    });
  });
  await page.goto("/history");
  await page.getByLabel("Email used when booking").fill("ada@example.com");
  await page.getByRole("button", { name: "View history" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more appointments" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(new URL(requests[1]).searchParams.get("cursor")).toBe(
    "opaque+/cursor=",
  );
  await expect(page.getByText("You’re all caught up.")).toBeVisible();
});
test("empty history is explicit", async ({ page }) => {
  await page.goto("/history");
  await page.getByLabel("Email used when booking").fill("nobody@example.com");
  await page.getByRole("button", { name: "View history" }).click();
  await expect(page.getByText("No bookings yet")).toBeVisible();
});
test("invalid history cursor permits restarting the search", async ({
  page,
}) => {
  let count = 0;
  await page.route("**/api/bookings?**", (route) => {
    count++;
    return route.fulfill(
      count === 1
        ? {
            json: {
              bookings: [
                {
                  ...body,
                  id: "one",
                  status: "confirmed",
                  created_at: new Date().toISOString(),
                },
              ],
              next_cursor: "invalid",
            },
          }
        : { status: 400, json: { error: "invalid cursor" } },
    );
  });
  await page.goto("/history");
  await page.getByLabel("Email used when booking").fill(body.email);
  await page.getByRole("button", { name: "View history" }).click();
  await page.getByRole("button", { name: "Load more appointments" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "start again",
  );
  await expect(
    page.getByRole("button", { name: "View history" }),
  ).toBeEnabled();
});
test("mobile pages and dialog fit a 375px viewport without horizontal scrolling", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ["/", "/book?slot_id=s0", "/find-booking", "/history"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const link of await page
      .getByRole("navigation")
      .getByRole("link")
      .all()) {
      const bounds = await link.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    }
  }
  await page.goto("/");
  await page.screenshot({
    path: "test-results/clinicslot-mobile.png",
    fullPage: true,
  });
  const booking = await (
    await request.post("/api/bookings", { data: body })
  ).json();
  await page.goto("/find-booking");
  await page.getByLabel("Booking ID", { exact: true }).fill(booking.id);
  await page.getByRole("button", { name: "Find booking", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await expect(
    dialog.getByRole("button", { name: "Keep appointment" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Keep appointment" }).click();
});
test("desktop presentation and keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page
    .getByRole("link", { name: "Skip to content" })
    .evaluate((node) => (node as HTMLElement).blur());
  await page.screenshot({
    path: "test-results/clinicslot-desktop.png",
    fullPage: true,
  });
});

test("BFF preserves real backend statuses, JSON, key replay, mismatch and Retry-After", async ({
  request,
}) => {
  const first = await request.post("/api/bookings", {
    headers: { "Idempotency-Key": "bff-key" },
    data: body,
  });
  expect(first.status()).toBe(201);
  const booking = await first.json();
  expect(Object.keys(booking).sort()).toEqual([
    "created_at",
    "email",
    "id",
    "name",
    "slot_id",
    "status",
  ]);
  const repeat = await request.post("/api/bookings", {
    headers: { "Idempotency-Key": "bff-key" },
    data: body,
  });
  expect(repeat.status()).toBe(201);
  expect(await repeat.json()).toEqual(booking);
  expect(
    (
      await request.post("/api/bookings", {
        headers: { "Idempotency-Key": "bff-key" },
        data: { ...body, name: "Changed" },
      })
    ).status(),
  ).toBe(422);
  expect((await request.post("/api/bookings", { data: body })).status()).toBe(
    409,
  );
  expect(
    (
      await request.post("/api/bookings", {
        data: { ...body, slot_id: "missing" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/bookings", { data: { ...body, name: "" } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/bookings", { data: { ...body, slot_id: "s1" } })
    ).status(),
  ).toBe(201);
  const denied = await request.post("/api/bookings", {
    data: { ...body, slot_id: "s2" },
  });
  expect(denied.status()).toBe(429);
  expect(denied.headers()["retry-after"]).toMatch(/^[1-9]\d*$/);
  expect(await denied.json()).toEqual({ error: expect.any(String) });
  expect(denied.headers()["cache-control"]).toBe("no-store");
});
test("BFF supports real history and cancellation and forwards malformed cursor 400", async ({
  request,
}) => {
  const booking = await (
    await request.post("/api/bookings", { data: body })
  ).json();
  expect((await request.delete("/api/bookings/" + booking.id)).status()).toBe(
    200,
  );
  expect((await request.delete("/api/bookings/" + booking.id)).status()).toBe(
    409,
  );
  expect((await request.delete("/api/bookings/missing")).status()).toBe(404);
  const history = await request.get(
    "/api/bookings?" +
      new URLSearchParams({ email: " ADA@EXAMPLE.COM ", limit: "1" }),
  );
  expect(history.status()).toBe(200);
  expect(await history.json()).toMatchObject({
    bookings: [{ id: booking.id, status: "cancelled" }],
    next_cursor: null,
  });
  expect(
    (
      await request.get("/api/bookings?email=ada@example.com&cursor=bad")
    ).status(),
  ).toBe(400);
});
test("BFF validates dynamic segments, prevents cross-origin mutation and does not proxy reset or URLs", async ({
  request,
}) => {
  expect(
    (await request.post("/api/reset", { data: { slots: [] } })).status(),
  ).toBe(404);
  expect((await request.post("/reset", { data: { slots: [] } })).status()).toBe(
    404,
  );
  expect(
    (await request.get("/api/proxy?url=https://example.com")).status(),
  ).toBe(404);
  expect(
    (
      await request.get(
        "/api/bookings/" + encodeURIComponent("missing/?x=1#fragment"),
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/bookings", {
        headers: { Origin: "https://foreign.example" },
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect((await request.get("/api/bookings?email=a&email=b")).status()).toBe(
    400,
  );
});
test("NUL inputs return controlled JSON errors through the real BFF and backend", async ({
  request,
}) => {
  const responses = [
    await request.get("/api/bookings/%00"),
    await request.delete("/api/bookings/%00"),
    await request.get("/api/slots?provider=%00"),
  ];
  for (const response of responses) {
    expect(response.status()).toBe(400);
    const data: unknown = await response.json();
    expect(data).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(data)).not.toContain(
      process.env.CLINICSLOT_TEST_KEY!,
    );
    expect(JSON.stringify(data)).not.toMatch(
      /22021|Postgres|Drizzle|stack|invalid byte sequence/,
    );
  }
  expect((await request.get("/api/slots")).status()).toBe(200);
});

test("API credential stays absent from HTML, assets, headers and browser requests", async ({
  page,
  request,
}) => {
  const key = process.env.CLINICSLOT_TEST_KEY!;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  page.on("request", (r) => calls.push({ url: r.url(), headers: r.headers() }));
  await page.goto("/");
  await expect(page.getByRole("article").first()).toBeVisible();
  expect(await page.content()).not.toContain(key);
  for (const call of calls) {
    expect(call.headers["x-api-key"]).toBeUndefined();
    expect(call.url).not.toContain(":3101");
  }
  for (const script of await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).src))) {
    const asset = await request.get(script);
    expect(await asset.text()).not.toContain(key);
  }
  const response = await request.get("/api/slots", {
    headers: { "X-API-Key": "browser-value-must-not-forward" },
  });
  expect(response.status()).toBe(200);
  expect(JSON.stringify(response.headers())).not.toContain(key);
  expect(await response.text()).not.toContain(key);
});
test("BFF follows real signed history cursors across PostgreSQL pages", async ({
  request,
}) => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await request.post("/api/bookings", {
      data: { ...body, slot_id: "s" + i },
    });
    expect(result.status()).toBe(201);
    ids.push((await result.json()).id);
  }
  const found: string[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ email: body.email, limit: "1" });
    if (cursor) params.set("cursor", cursor);
    const result = await request.get("/api/bookings?" + params);
    expect(result.status()).toBe(200);
    const page = await result.json();
    found.push(...page.bookings.map((b: { id: string }) => b.id));
    cursor = page.next_cursor;
  } while (cursor);
  expect(found).toEqual(ids);
});
test("supports an empty provider and an encoded arbitrary string slot ID without normalization", async ({
  page,
  request,
}) => {
  const unusual = "Case Sensitive / slot? &";
  const installed = await request.post("http://127.0.0.1:3101/reset", {
    headers: { "X-API-Key": process.env.CLINICSLOT_TEST_KEY! },
    data: { slots: [slot(unusual, ""), slot("other", "Dr Ade")] },
  });
  expect(installed.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(2);
  const filtered = page.waitForResponse((r) =>
    r.url().endsWith("/api/slots?provider="),
  );
  await page
    .getByLabel("Healthcare provider")
    .selectOption({ label: "(Unnamed provider)" });
  await filtered;
  await expect(page.getByRole("article")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Book appointment", exact: true })
    .click();
  await page.getByLabel("Full name").fill(body.name);
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(body.email);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re booked in." }),
  ).toBeVisible();
  const id = (await page.locator("code").textContent())!;
  expect(
    await (await request.get("/api/bookings/" + encodeURIComponent(id))).json(),
  ).toMatchObject({ slot_id: unusual });
});

for (const id of [".", ".."])
  test(
    "books a literal dot-segment slot ID: " + id,
    async ({ page, request }) => {
      const installed = await request.post("http://127.0.0.1:3101/reset", {
        headers: { "X-API-Key": process.env.CLINICSLOT_TEST_KEY! },
        data: { slots: [slot(id)] },
      });
      expect(installed.status()).toBe(200);
      await page.goto("/");
      await page
        .getByRole("link", { name: "Book appointment", exact: true })
        .click();
      await page.getByLabel("Full name").fill(body.name);
      await page
        .getByRole("textbox", { name: "Email address", exact: true })
        .fill(body.email);
      await page.getByRole("button", { name: "Confirm booking" }).click();
      await expect(
        page.getByRole("heading", { name: "You’re booked in." }),
      ).toBeVisible();
      const bookingId = (await page.locator("code").textContent())!;
      expect(
        await (
          await request.get("/api/bookings/" + encodeURIComponent(bookingId))
        ).json(),
      ).toMatchObject({ slot_id: id });
    },
  );
