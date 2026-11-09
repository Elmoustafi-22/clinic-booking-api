import { Suspense } from "react";
import { BookingForm } from "@/components/booking-form";
import { Loading } from "@/components/ui/feedback";
export const metadata = { title: "Book an appointment" };
type Props = { searchParams: Promise<{ slot_id?: string | string[] }> };
async function Appointment({ searchParams }: Props) {
  const query = await searchParams;
  return (
    <BookingForm
      slotId={typeof query.slot_id === "string" ? query.slot_id : ""}
    />
  );
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Appointment {...props} />
    </Suspense>
  );
}
