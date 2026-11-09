import type { Booking, BookingPage, NewBooking, Slot } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, { ...init, cache: "no-store" });
  } catch {
    throw new ApiError(0, "We couldn’t connect. Please try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const retry = Number(response.headers.get("Retry-After"));
    throw new ApiError(
      response.status,
      typeof data?.error === "string"
        ? data.error
        : "Something went wrong. Please try again.",
      Number.isInteger(retry) && retry > 0 ? retry : undefined,
    );
  }
  return data as T;
}
export const api = {
  slots: (provider?: string, signal?: AbortSignal) =>
    send<{ slots: Slot[] }>(
      "/slots" +
        (provider !== undefined ? "?" + new URLSearchParams({ provider }) : ""),
      { signal },
    ),
  book: (body: NewBooking, key: string) =>
    send<Booking>("/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  booking: (id: string) => send<Booking>("/bookings/" + encodeURIComponent(id)),
  cancel: (id: string) =>
    send<Booking>("/bookings/" + encodeURIComponent(id), { method: "DELETE" }),
  history: (email: string, cursor?: string) =>
    send<BookingPage>(
      "/bookings?" +
        new URLSearchParams({
          email,
          limit: "10",
          ...(cursor ? { cursor } : {}),
        }),
    ),
};
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Something went wrong. Please try again.";
  const messages: Record<number, string> = {
    401: "The booking service is temporarily unavailable. Please try again later.",
    404: "We couldn’t find that appointment or booking. Check the details and try again.",
    409: "This appointment is no longer available, or this booking has already been cancelled. Refresh to see the latest details.",
    422: "These details differ from your previous request. Review them and start a new booking.",
    429:
      "You’ve made several booking attempts. " +
      (error.retryAfter
        ? "Please wait " + error.retryAfter + " seconds before trying again."
        : "Please wait a minute before trying again."),
    500: "The booking service is temporarily unavailable. Please try again.",
    502: "We couldn’t reach the booking service. Please try again.",
    503: "The booking service is temporarily unavailable.",
    504: "The booking service took too long to respond. Please retry with the same details.",
  };
  return messages[error.status] ?? error.message;
}
