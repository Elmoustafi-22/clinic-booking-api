import { backend } from "@/lib/server/backend";
export async function GET(request: Request) {
  return backend(request, "/bookings", ["email", "limit", "cursor"]);
}
export async function POST(request: Request) {
  return backend(request, "/bookings");
}
