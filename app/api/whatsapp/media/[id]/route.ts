import { promises as fs } from "fs";
import path from "path";
import { MEDIA_DIR } from "@/lib/chatlog";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", amr: "audio/amr" };

// Plays back a voice note on the demo screen.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}\.(ogg|mp3|m4a|aac|amr)$/.test(id)) return new Response("not found", { status: 404 });
  try {
    const data = await fs.readFile(path.join(MEDIA_DIR, id));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": TYPES[id.split(".").pop()!], "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
