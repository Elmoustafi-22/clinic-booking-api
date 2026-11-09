import { backend } from "@/lib/server/backend";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return backend(request, { bookingId: (await context.params).id });
}
export async function DELETE(request: Request, context: Context) {
  return backend(request, { bookingId: (await context.params).id });
}
