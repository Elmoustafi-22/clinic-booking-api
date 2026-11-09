"use client";
import { useRef, useState } from "react";
import { ArrowDown, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorNotice } from "@/components/ui/feedback";
import { BookingDetails } from "@/components/booking-details";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSlots } from "@/lib/use-slots";
import type { Booking } from "@/lib/types";
export function BookingHistory() {
  const [email, setEmail] = useState(""),
    [query, setQuery] = useState(""),
    [bookings, setBookings] = useState<Booking[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const { slots, refresh } = useSlots();
  async function load(more = false) {
    if (lock.current) return;
    const address = more ? query : email.trim();
    if (!address) {
      setError("Enter your email address.");
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    if (!more) {
      setBookings([]);
      setCursor(null);
      setSearched(false);
      setQuery(address);
    }
    try {
      const page = await api.history(
        address,
        more ? (cursor ?? undefined) : undefined,
      );
      setBookings((previous) => {
        const merged = new Map((more ? previous : []).map((b) => [b.id, b]));
        page.bookings.forEach((b) => merged.set(b.id, b));
        return [...merged.values()];
      });
      setCursor(page.next_cursor);
      setSearched(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? "We couldn’t load this page of history. Check the email, then choose “View history” to start again."
          : errorMessage(err),
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="eyebrow">KEEP TRACK OF YOUR CARE</p>
        <h1 className="page-title mt-3">Your booking history.</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          Find your confirmed and cancelled appointments, all in one place.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        noValidate
        className="space-y-4 rounded-2xl border border-border bg-white p-6 sm:p-7"
      >
        <label htmlFor="history-email" className="block text-sm font-semibold">
          Email used when booking
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="history-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            disabled={pending}
          />
          <Button type="submit" disabled={pending}>
            <Mail />
            {pending ? "Loading…" : "View history"}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Email lookup does not verify patient identity. Only look up details
          you are permitted to access.
        </p>
      </form>
      {error ? (
        <div className="mt-6">
          <ErrorNotice>{error}</ErrorNotice>
        </div>
      ) : null}
      {searched ? (
        <section
          className="mt-8 space-y-5"
          aria-label="Booking history results"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              Appointments for <span className="break-all">{query}</span>
            </h2>
            <span className="text-xs text-muted-foreground">Oldest first</span>
          </div>
          {bookings.length === 0 ? (
            <EmptyState title="No bookings yet">
              We couldn’t find any appointments for this email. Check the
              address or book your first visit.
            </EmptyState>
          ) : (
            bookings.map((booking) => (
              <BookingDetails
                key={booking.id}
                booking={booking}
                slot={slots.find((s) => s.id === booking.slot_id)}
                onUpdate={(updated) =>
                  setBookings((previous) =>
                    previous.map((b) => (b.id === updated.id ? updated : b)),
                  )
                }
                refreshSlots={refresh}
              />
            ))
          )}
          {cursor ? (
            <div className="pt-3 text-center">
              <Button
                variant="outline"
                onClick={() => void load(true)}
                disabled={pending}
              >
                {pending ? "Loading…" : "Load more appointments"}
                <ArrowDown />
              </Button>
            </div>
          ) : bookings.length > 0 ? (
            <p className="pt-3 text-center text-xs text-muted-foreground">
              You’re all caught up.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
