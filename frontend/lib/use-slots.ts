"use client";
import { useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import type { Slot } from "./types";
export function useSlots() {
  const [slots, setSlots] = useState<Slot[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .slots(undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSlots(data.slots);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  function refresh() {
    setLoading(true);
    setError(null);
    setRevision((n) => n + 1);
  }
  return { slots, loading, error, refresh };
}
export function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);
  return now;
}
