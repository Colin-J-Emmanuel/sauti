import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST multipart/form-data with either `audio` (a voice note) or `text`.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    const text = form.get("text");

    const result =
      audio instanceof File && audio.size > 0
        ? await runAgent({
            kind: "audio",
            data: new Uint8Array(await audio.arrayBuffer()),
            mimeType: audio.type || "audio/webm",
          })
        : typeof text === "string" && text.trim()
          ? await runAgent({ kind: "text", text })
          : null;

    if (!result) return NextResponse.json({ error: "Send `audio` or `text`." }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
