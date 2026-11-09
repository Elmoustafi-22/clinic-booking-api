import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "ClinicSlot — Care, on your schedule",
    template: "%s | ClinicSlot",
  },
  description:
    "Find an appointment, book your visit and manage your bookings with ClinicSlot.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
