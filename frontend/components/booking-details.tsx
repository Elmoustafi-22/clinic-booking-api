"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import {
  CalendarDays,
  Check,
  Copy,
  Clock3,
  Mail,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNotice, StatusBadge } from "@/components/ui/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { appointmentDate, appointmentTime } from "@/lib/utils";
import type { Booking, Slot } from "@/lib/types";
export function BookingDetails({
  booking,
  slot,
  onUpdate,
  refreshSlots,
}: {
  booking: Booking;
  slot?: Slot;
  onUpdate: (booking: Booking) => void;
  refreshSlots: () => void;
}) {
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const lock = useRef(false);
  async function cancel() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const updated = await api.cancel(booking.id);
      onUpdate(updated);
      refreshSlots();
      setOpen(false);
    } catch (e) {
      setOpen(false);
      setError(
        e instanceof ApiError && e.status === 404
          ? "This booking no longer exists. It may have been removed."
          : e instanceof ApiError && e.status === 409
            ? "This booking has already been cancelled. The latest status has been refreshed."
            : errorMessage(e),
      );
      if (e instanceof ApiError && e.status === 409) {
        try {
          onUpdate(await api.booking(booking.id));
          refreshSlots();
          setOpen(false);
        } catch {
          /* Keep the original error visible if refresh also fails. */
        }
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(booking.id);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary">
            <Stethoscope className="size-5" />
          </span>
          <h3 className="font-semibold">
            {slot?.provider || "Your appointment"}
          </h3>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      <div className="space-y-6 p-5 sm:p-7">
        {slot ? (
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <p className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" />
              {appointmentDate(slot.start)}
            </p>
            <p className="flex items-center gap-2">
              <Clock3 className="size-4 shrink-0 text-primary" />
              {appointmentTime(slot.start)} – {appointmentTime(slot.end)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Appointment schedule unavailable. Slot reference:{" "}
            <span className="break-all font-mono">{booking.slot_id}</span>
          </p>
        )}
        <div className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
          <p className="flex items-center gap-2">
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="break-words">{booking.name}</span>
          </p>
          <p className="flex min-w-0 items-center gap-2">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <span className="break-all">{booking.email}</span>
          </p>
        </div>
        <div className="rounded-xl bg-muted/70 p-4">
          <p className="mb-2 text-xs text-muted-foreground">Booking ID</p>
          <div className="flex items-start justify-between gap-3">
            <code className="break-all text-sm font-medium">{booking.id}</code>
            <button
              type="button"
              aria-label="Copy booking ID"
              onClick={copy}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-white"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {copyError
              ? "Couldn’t copy automatically. Select and copy the ID above."
              : copied
                ? "Booking ID copied."
                : "Keep this reference to find your booking later."}
          </p>
        </div>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline">
            <Link href="/">View appointments</Link>
          </Button>
          {booking.status === "confirmed" ? (
            <AlertDialog.Root
              open={open}
              onOpenChange={(value) => {
                if (!pending) setOpen(value);
              }}
            >
              <AlertDialog.Trigger asChild>
                <Button variant="ghost" className="text-destructive">
                  Cancel booking
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-40 bg-foreground/35 backdrop-blur-[2px]" />
                <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-white p-6 shadow-xl">
                  <AlertDialog.Title className="text-xl font-semibold">
                    Cancel this appointment?
                  </AlertDialog.Title>
                  <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
                    Your booking will be marked as cancelled and this time will
                    become available for someone else. You can book a new
                    appointment later.
                  </AlertDialog.Description>
                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <AlertDialog.Cancel asChild>
                      <Button variant="outline" disabled={pending}>
                        Keep appointment
                      </Button>
                    </AlertDialog.Cancel>
                    <Button
                      variant="destructive"
                      disabled={pending}
                      onClick={cancel}
                    >
                      {pending ? "Cancelling…" : "Yes, cancel booking"}
                    </Button>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          ) : (
            <p className="text-sm text-muted-foreground">
              This booking has been cancelled.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
