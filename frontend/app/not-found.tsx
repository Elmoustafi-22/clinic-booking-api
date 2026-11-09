import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function Page() {
  return (
    <div className="py-20 text-center">
      <p className="eyebrow">PAGE NOT FOUND</p>
      <h1 className="mt-4 text-4xl font-semibold">A little off schedule.</h1>
      <p className="mt-4 mb-8 text-muted-foreground">
        This page isn’t here. Let’s find you an appointment.
      </p>
      <Button asChild>
        <Link href="/">View appointments</Link>
      </Button>
    </div>
  );
}
