import { backend } from "@/lib/server/backend";
export async function GET(request: Request) {
  return backend(request, "/slots", ["provider"]);
}
