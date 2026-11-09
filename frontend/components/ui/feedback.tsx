import { AlertCircle, CalendarSearch, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
    >
      <AlertCircle className="mt-1 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
      <CalendarSearch className="mx-auto mb-4 size-9 text-primary" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
export function Loading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <LoaderCircle className="size-5 animate-spin" />
      Loading appointments…
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        status === "confirmed" || status === "Available"
          ? "bg-success/10 text-success"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
