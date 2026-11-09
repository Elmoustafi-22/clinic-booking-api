"use client";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpRight, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";
const links = [
  ["/", "Appointments"],
  ["/find-booking", "Find a booking"],
  ["/history", "Booking history"],
];
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white p-4 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-xl font-bold tracking-tight"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
              <HeartPulse className="size-6" />
            </span>
            Clinic<span className="-ml-2 text-primary">Slot</span>
          </Link>
          <Suspense fallback={<NavigationLinks />}>
            <Navigation />
          </Suspense>
          <span className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <span className="size-2 rounded-full bg-primary" />
            Care, on your schedule
          </span>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8 sm:py-12"
      >
        {children}
      </main>
      <footer className="mt-12 border-t border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-7 text-xs text-muted-foreground sm:px-8">
          <p>
            ClinicSlot <span className="mx-2 text-border">|</span> A little less
            waiting. A little more care.
          </p>
          <Link
            href="/find-booking"
            className="flex items-center gap-1 hover:text-primary"
          >
            Manage your appointment
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </footer>
    </>
  );
}

function Navigation() {
  return <NavigationLinks pathname={usePathname()} />;
}
function NavigationLinks({ pathname }: { pathname?: string }) {
  return (
    <nav
      aria-label="Main navigation"
      className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:gap-3"
    >
      {links.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium transition-colors hover:bg-muted sm:px-3 sm:text-sm",
            pathname === href
              ? "bg-primary/7 text-primary"
              : "text-muted-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
