import { handleDrawRequest } from "@/lib/draw-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleDrawRequest(request, "turn");
}
