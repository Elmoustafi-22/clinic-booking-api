"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  HeartPulse,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorNotice,
  Loading,
  StatusBadge,
} from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { appointmentDate, appointmentTime, canBook } from "@/lib/utils";
import { useNow, useSlots } from "@/lib/use-slots";
import type { Slot } from "@/lib/types";
export function Appointments() {
  const { slots, loading, error, refresh } = useSlots();
  const [provider, setProvider] = useState<string | null>(null),
    [onlyAvailable, setOnlyAvailable] = useState(false),
    [filtered, setFiltered] = useState<Slot[] | null>(null),
    [filterError, setFilterError] = useState<string | null>(null),
    [filtering, setFiltering] = useState(false);
  const now = useNow();
  useEffect(() => {
    if (provider === null) return;
    const controller = new AbortController();
    api
      .slots(provider, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFiltered(data.slots);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setFilterError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setFiltering(false);
      });
    return () => controller.abort();
  }, [provider, slots]);
  const visible = (provider !== null ? (filtered ?? []) : slots).filter(
    (slot) => !onlyAvailable || (now !== null && canBook(slot, now)),
  );
  const providers = Array.from(new Set(slots.map((s) => s.provider)));
  const busy = loading || filtering;
  return (
    <>
      <section className="relative mb-10 grid overflow-hidden rounded-3xl border border-primary/10 bg-[#e6efea] lg:grid-cols-[1.2fr_1fr]">
        <div className="relative z-10 p-7 sm:p-11 lg:p-12">
          <p className="eyebrow flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" />
            YOUR WELLBEING, MADE SIMPLE
          </p>
          <h1 className="mt-5 max-w-xl text-4xl leading-[1.12] font-semibold tracking-[-.045em] text-foreground sm:text-5xl lg:text-[3.45rem]">
            Good care.
            <br />
            At a time that works.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground sm:text-base">
            Find your provider, choose a time, and take the next step toward
            feeling your best.
          </p>
          <a
            href="#appointments"
            className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            Find your appointment
            <ArrowRight className="size-4" />
          </a>
        </div>
        <div
          aria-hidden="true"
          className="relative hidden items-center justify-center overflow-hidden p-8 lg:flex"
        >
          <div className="absolute size-80 rounded-full border border-primary/10" />
          <div className="absolute size-[26rem] rounded-full border border-primary/7" />
          <div className="relative w-66 -rotate-6 rounded-2xl border border-white bg-white/90 p-6 shadow-[0_15px_40px_-18px_#17685c55]">
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarDays className="size-6" />
              </span>
              <span className="rounded-full bg-success/10 px-3 py-1 text-[10px] font-semibold text-success">
                A little time for you
              </span>
            </div>
            <div className="mt-6 h-2 w-24 rounded bg-primary/15" />
            <div className="mt-3 h-2 w-36 rounded bg-primary/8" />
            <div className="mt-6 grid grid-cols-7 gap-2">
              {Array.from({ length: 21 }, (_, i) => (
                <span
                  key={i}
                  className={
                    "aspect-square rounded-md " +
                    (i === 10
                      ? "flex items-center justify-center bg-primary text-white"
                      : "bg-muted")
                  }
                >
                  {i === 10 ? <Check className="size-4" /> : null}
                </span>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-primary">
              <HeartPulse className="size-4" />
              Your next step starts here.
            </div>
          </div>
          <span className="absolute right-9 bottom-10 flex size-16 items-center justify-center rounded-2xl border border-white bg-[#d3e3d7] text-primary shadow-sm">
            <Stethoscope className="size-8" />
          </span>
        </div>
      </section>
      <section id="appointments" className="scroll-mt-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">MAKE TIME FOR YOURSELF</p>
            <h2 className="text-2xl font-semibold tracking-tight">
              Find an appointment
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A convenient visit starts with the right time.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setFilterError(null);
              if (provider !== null) setFiltering(true);
              refresh();
            }}
            disabled={busy}
          >
            <RefreshCw className={busy ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-white p-4">
              <div className="flex min-w-0 w-full items-center gap-3 sm:w-auto sm:flex-1">
                <SlidersHorizontal className="size-4 shrink-0 text-primary" />
                <label htmlFor="provider" className="sr-only">
                  Healthcare provider
                </label>
                <select
                  id="provider"
                  value={provider === null ? "" : "provider:" + provider}
                  onChange={(e) => {
                    setProvider(
                      e.target.value === ""
                        ? null
                        : e.target.value.slice("provider:".length),
                    );
                    setFiltered(null);
                    setFilterError(null);
                    setFiltering(!!e.target.value);
                  }}
                  className="min-h-10 min-w-0 flex-1 rounded-lg border-0 bg-white pr-3 text-sm font-medium outline-none"
                >
                  <option value="">All healthcare providers</option>
                  {providers.map((p) => (
                    <option key={p} value={"provider:" + p}>
                      {p || "(Unnamed provider)"}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 border-border text-xs text-muted-foreground sm:border-l sm:pl-4">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={onlyAvailable}
                  onChange={(e) => setOnlyAvailable(e.target.checked)}
                />
                Available only
              </label>
            </div>
            {error || filterError ? (
              <div className="mb-5 space-y-4">
                <ErrorNotice>{error || filterError}</ErrorNotice>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilterError(null);
                    if (provider !== null) setFiltering(true);
                    refresh();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : busy ? (
              <Loading />
            ) : visible.length === 0 ? (
              <EmptyState title="No appointments to show">
                {onlyAvailable
                  ? "There are no available appointments for this selection. Try another provider or check back soon."
                  : "There are no appointments for this selection yet. Try another provider or check back soon."}
              </EmptyState>
            ) : (
              <>
                <p className="mb-4 text-xs text-muted-foreground">
                  {visible.length} appointment{visible.length === 1 ? "" : "s"}{" "}
                  <span className="mx-1.5">·</span> Times shown in your local
                  timezone
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {visible.map((slot) => {
                    const started =
                      now !== null && new Date(slot.start).getTime() <= now;
                    const available = now !== null && canBook(slot, now);
                    return (
                      <article
                        key={slot.id}
                        className="group flex flex-col rounded-2xl border border-border bg-white p-5 transition-shadow hover:shadow-[0_6px_24px_-14px_#18302d40]"
                      >
                        <div className="mb-5 flex items-center justify-between gap-2">
                          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary">
                            <Stethoscope className="size-5" />
                          </span>
                          <StatusBadge
                            status={
                              started
                                ? "Started"
                                : slot.available
                                  ? "Available"
                                  : "Booked"
                            }
                          />
                        </div>
                        <h3 className="text-lg font-semibold tracking-tight">
                          {slot.provider || "Healthcare provider"}
                        </h3>
                        <div className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                          <p className="flex items-center gap-2">
                            <CalendarDays className="size-4 text-primary/70" />
                            {appointmentDate(slot.start)}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock3 className="size-4 shrink-0 text-primary/70" />
                            <span>
                              {appointmentTime(slot.start)} –{" "}
                              {appointmentTime(slot.end)}
                            </span>
                          </p>
                        </div>
                        <div className="mt-6 border-t border-border pt-4">
                          {available ? (
                            <Button asChild className="w-full justify-between">
                              <Link
                                href={
                                  "/book?" +
                                  new URLSearchParams({ slot_id: slot.id })
                                }
                              >
                                Book appointment
                                <ArrowRight />
                              </Link>
                            </Button>
                          ) : (
                            <Button
                              disabled
                              variant="outline"
                              className="w-full"
                            >
                              {started
                                ? "Appointment has started"
                                : now === null
                                  ? "Checking availability…"
                                  : "Unavailable"}
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <aside className="space-y-5">
            <div className="rounded-2xl border border-border bg-white p-6">
              <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                <HeartPulse className="size-5" />
              </span>
              <h3 className="text-lg font-semibold tracking-tight">
                A simpler path to care
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your next appointment is just a few steps away.
              </p>
              <ol className="mt-6 space-y-5">
                {[
                  [
                    "Choose your time",
                    "Explore providers and find a slot that fits.",
                  ],
                  ["Make it yours", "Add your name and email to book."],
                  [
                    "You’re all set",
                    "Keep your booking ID to manage your visit.",
                  ],
                ].map(([title, copy], i) => (
                  <li key={title} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {copy}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <Link
              href="/find-booking"
              className="flex items-start gap-3 rounded-2xl border border-primary/10 bg-primary/5 p-5"
            >
              <Search className="mt-1 size-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold">
                  Already have a booking?
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Look it up or make a change.
                </span>
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-primary" />
            </Link>
          </aside>
        </div>
      </section>
    </>
  );
}
