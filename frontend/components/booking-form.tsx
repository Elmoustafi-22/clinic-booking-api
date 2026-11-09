"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorNotice, Loading } from "@/components/ui/feedback";
import { BookingDetails } from "@/components/booking-details";
import { api, errorMessage } from "@/lib/api";
import { appointmentDate, appointmentTime, canBook } from "@/lib/utils";
import { useNow, useSlots } from "@/lib/use-slots";
import type { Booking } from "@/lib/types";
export function BookingForm({ slotId }: { slotId: string }) {
  const { slots, loading, error, refresh } = useSlots();
  const now = useNow();
  const slot = slots.find((s) => s.id === slotId);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [pending, setPending] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [validation, setValidation] = useState<{ name?: string; email?: string }>(
      {},
    ),
    [booking, setBooking] = useState<Booking | null>(null);
  const intent = useRef<{ body: string; key: string } | null>(null),
    lock = useRef(false);
  const available = !!slot && now !== null && canBook(slot, now);
  function changed() {
    intent.current = null;
    setFailure(null);
    setValidation({});
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    const fields: { name?: string; email?: string } = {};
    if (!name.trim()) fields.name = "Enter your full name.";
    if (!email.trim()) fields.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      fields.email = "Enter a valid email address.";
    setValidation(fields);
    if (Object.keys(fields).length) return;
    if (!available) {
      setFailure(
        "This appointment is no longer available. Please choose another time.",
      );
      return;
    }
    const body = { slot_id: slotId, name, email };
    const fingerprint = JSON.stringify(body);
    if (!intent.current || intent.current.body !== fingerprint)
      intent.current = { body: fingerprint, key: crypto.randomUUID() };
    lock.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await api.book(body, intent.current.key);
      setBooking(result);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  if (loading) return <Loading />;
  if (error)
    return (
      <div className="space-y-5">
        <ErrorNotice>{error}</ErrorNotice>
        <Button onClick={refresh}>Try again</Button>
      </div>
    );
  if (booking)
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="size-7" />
          </span>
          <p className="eyebrow">YOUR TIME IS RESERVED</p>
          <h1 className="page-title mt-3">You’re booked in.</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Here are your appointment details. Keep your booking ID handy.
          </p>
        </div>
        <BookingDetails
          booking={booking}
          slot={slot}
          onUpdate={setBooking}
          refreshSlots={refresh}
        />
      </div>
    );
  if (!slot)
    return (
      <EmptyState title="Appointment not found">
        This time may have been removed.{" "}
        <Link href="/" className="underline">
          Choose another appointment.
        </Link>
      </EmptyState>
    );
  return (
    <>
      <Link
        href="/"
        className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        All appointments
      </Link>
      <div className="mb-9">
        <p className="eyebrow">A LITTLE TIME FOR YOUR HEALTH</p>
        <h1 className="page-title mt-3">Let’s book your visit.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Review your appointment and add your details below.
        </p>
      </div>
      <div className="grid items-start gap-7 lg:grid-cols-[.85fr_1.15fr]">
        <aside className="rounded-2xl border border-primary/15 bg-[#e6efea] p-7 sm:p-9">
          <span className="mb-5 flex size-12 items-center justify-center rounded-xl bg-white text-primary">
            <Stethoscope className="size-6" />
          </span>
          <p className="eyebrow">YOUR APPOINTMENT</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            {slot.provider}
          </h2>
          <div className="mt-6 space-y-4 text-sm">
            <p className="flex items-center gap-3">
              <CalendarDays className="size-5 text-primary" />
              {appointmentDate(slot.start)}
            </p>
            <p className="flex items-center gap-3">
              <Clock3 className="size-5 shrink-0 text-primary" />
              {appointmentTime(slot.start)} – {appointmentTime(slot.end)}
            </p>
          </div>
          <p className="mt-7 border-t border-primary/15 pt-5 text-xs leading-6 text-muted-foreground">
            Times are shown in your local timezone. Your appointment is reserved
            once your booking is confirmed.
          </p>
        </aside>
        <form
          onSubmit={submit}
          noValidate
          className="space-y-6 rounded-2xl border border-border bg-white p-6 sm:p-9"
        >
          <div>
            <h2 className="text-xl font-semibold">Your details</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A name and email are all we need to get started.
            </p>
          </div>
          <div>
            <label htmlFor="name" className="mb-2 block text-sm font-semibold">
              Full name{" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="e.g. Ada Obi"
              value={name}
              onChange={(e) => {
                changed();
                setName(e.target.value);
              }}
              required
              disabled={pending}
              aria-invalid={!!validation.name}
              aria-describedby={validation.name ? "name-error" : undefined}
            />
            {validation.name ? (
              <p id="name-error" className="mt-2 text-xs text-destructive">
                {validation.name}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-semibold">
              Email address{" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                changed();
                setEmail(e.target.value);
              }}
              required
              disabled={pending}
              aria-invalid={!!validation.email}
              aria-describedby={validation.email ? "email-error" : "email-help"}
            />
            {validation.email ? (
              <p id="email-error" className="mt-2 text-xs text-destructive">
                {validation.email}
              </p>
            ) : (
              <p id="email-help" className="mt-2 text-xs text-muted-foreground">
                Use this email to look up your booking history later.
              </p>
            )}
          </div>
          {!available ? (
            <ErrorNotice>
              This appointment is no longer available. Please choose another
              time.
            </ErrorNotice>
          ) : null}
          {failure ? <ErrorNotice>{failure}</ErrorNotice> : null}
          <Button
            type="submit"
            className="w-full justify-between"
            disabled={pending || !available}
          >
            {pending ? "Booking your appointment…" : "Confirm booking"}
            <ArrowRight />
          </Button>
          <p className="text-center text-xs leading-6 text-muted-foreground">
            No account needed. You’ll receive your booking reference on the next
            screen.
          </p>
        </form>
      </div>
    </>
  );
}
