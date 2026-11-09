import { cn } from "@/lib/utils";
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-12 w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-3 focus:ring-primary/15 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
