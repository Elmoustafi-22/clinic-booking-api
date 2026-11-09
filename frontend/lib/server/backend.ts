import "server-only";

const fail = (status: number, error: string) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
// Only these explicitly constructed paths may reach the configured backend.
export async function backend(
  request: Request,
  path: "/slots" | "/bookings" | { bookingId: string },
  queryKeys: string[] = [],
) {
  const apiKey = process.env.API_KEY;
  const base = process.env.BACKEND_API_URL;
  if (!apiKey?.trim() || !base) return fail(503, "Booking service unavailable");
  let url: URL;
  try {
    url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return fail(503, "Booking service unavailable");
    const suffix =
      typeof path === "string"
        ? path
        : "/bookings/" + encodeURIComponent(path.bookingId);
    if (
      typeof path !== "string" &&
      (!path.bookingId ||
        [".", ".."].includes(path.bookingId) ||
        /[\u0000-\u001f\u007f]/.test(path.bookingId))
    )
      return fail(400, "Invalid booking ID");
    url.pathname = url.pathname.replace(/\/$/, "") + suffix;
    const incoming = new URL(request.url);
    for (const key of queryKeys)
      for (const value of incoming.searchParams.getAll(key))
        url.searchParams.append(key, value);
  } catch {
    return fail(503, "Booking service unavailable");
  }
  if (request.method !== "GET") {
    const origin = request.headers.get("Origin");
    // Next may construct request.url with its internal listen hostname. Host
    // remains the public authority supplied by the browser/platform.
    const publicUrl = new URL(request.url);
    const host = request.headers.get("Host");
    if (host) publicUrl.host = host;
    if (
      (origin && origin !== publicUrl.origin) ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return fail(403, "Cross-origin request rejected");
  }
  let headers: Headers;
  try {
    headers = new Headers({ "X-API-Key": apiKey, Accept: "application/json" });
  } catch {
    return fail(503, "Booking service unavailable");
  }
  let body: string | undefined;
  if (request.method === "POST") {
    headers.set("Content-Type", "application/json");
    const key = request.headers.get("Idempotency-Key");
    if (key !== null) headers.set("Idempotency-Key", key);
    try {
      body = await request.text();
    } catch {
      return fail(400, "Invalid request body");
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400)
      return fail(502, "Invalid booking service response");
    if (upstream.status >= 500)
      return fail(upstream.status, "Booking service unavailable");
    const data: unknown = await upstream.json();
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const retry = upstream.headers.get("Retry-After");
    if (upstream.status === 429 && retry && /^[1-9]\d*$/.test(retry))
      responseHeaders.set("Retry-After", retry);
    return Response.json(data, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return fail(
      controller.signal.aborted ? 504 : 502,
      controller.signal.aborted
        ? "Booking service timed out"
        : "Booking service unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
}
