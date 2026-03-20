import { loadingMessages } from "@/lib/loading-messages";

export async function GET() {
  return Response.json({
    messages: loadingMessages
  });
}
