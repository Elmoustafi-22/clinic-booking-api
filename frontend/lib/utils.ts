import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function appointmentDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
export function appointmentTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
export function canBook(
  slot: { id: string; available: boolean; start: string },
  now = Date.now(),
) {
  return (
    /\S/.test(slot.id) && slot.available && new Date(slot.start).getTime() > now
  );
}
