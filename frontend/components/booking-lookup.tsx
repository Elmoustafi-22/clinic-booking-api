"use client";
import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNotice } from "@/components/ui/feedback";
import { BookingDetails } from "@/components/booking-details";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSlots } from "@/lib/use-slots";
import type { Booking } from "@/lib/types";
export function BookingLookup() {
  const [id, setId] = useState(""),
    [booking, setBooking] = useState<Booking | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const { slots, refresh } = useSlots();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (!id.trim()) {
      setError("Enter your booking ID.");
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    setBooking(null);
    try {
      setBooking(await api.booking(id.trim()));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "We couldn’t find a booking with that ID. Check your reference and try again."
          : errorMessage(err),
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <p className="eyebrow">YOUR APPOINTMENT, AT A GLANCE</p>
        <h1 className="page-title mt-3">Find your booking.</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          Have your reference handy? View your appointment details or cancel
          your visit here.
        </p>
      </div>
      <form
        onSubmit={submit}
        noValidate
        className="mb-7 space-y-4 rounded-2xl border border-border bg-white p-6 sm:p-7"
      >
        <label htmlFor="booking-id" className="block text-sm font-semibold">
          Booking ID
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="booking-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="Enter your booking reference"
            required
            disabled={pending}
          />
          <Button type="submit" disabled={pending}>
            <Search />
            {pending ? "Finding…" : "Find booking"}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Your reference was shown when you booked. Booking lookup does not
          verify patient identity.
        </p>
      </form>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {booking ? (
        <BookingDetails
          booking={booking}
          slot={slots.find((s) => s.id === booking.slot_id)}
          onUpdate={setBooking}
          refreshSlots={refresh}
        />
      ) : null}
    </div>
  );
}
