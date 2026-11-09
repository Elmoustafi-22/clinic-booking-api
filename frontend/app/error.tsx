"use client";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/feedback";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-5 py-16">
      <h1 className="text-3xl font-semibold">Let’s try that again</h1>
      <ErrorNotice>We couldn’t load this page. Please try again.</ErrorNotice>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
