export interface Slot {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
}
export interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
}
export interface NewBooking {
  slot_id: string;
  name: string;
  email: string;
}
export interface BookingPage {
  bookings: Booking[];
  next_cursor: string | null;
}
