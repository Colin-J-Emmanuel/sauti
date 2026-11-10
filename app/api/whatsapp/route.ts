import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { markEventProcessed } from "@/lib/ledger";
import {
  downloadMedia,
  formatReply,
  rememberShop,
  runAfterResponse,
  sendWhatsApp,
  verifyMetaSignature,
} from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

// Meta checks the webhook once when you save it: echo hub.challenge if the verify token matches.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ok =
    q.get("hub.mode") === "subscribe" &&
    !!process.env.WHATSAPP_VERIFY_TOKEN &&
    q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? new Response(q.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
}

type WaMessage = {
  id: string;
  from: string; // e.g. "19175550123" (no +)
  type: "text" | "audio" | string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
};

// Meta calls this for every message (and delivery/read statuses, which we ignore).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: "not json" });
  }

  const messages: WaMessage[] = (body?.entry ?? []).flatMap((e: any) =>
    (e?.changes ?? []).flatMap((c: any) => c?.value?.messages ?? []),
  );

  for (const msg of messages) {
    // Meta retries webhooks; handle each message once.
    if (!(await markEventProcessed(`wa:${msg.id}`))) continue;

    const isAudio = msg.type === "audio" && !!msg.audio?.id;
    const text = msg.type === "text" ? (msg.text?.body ?? "").trim() : "";

    // WhatsApp expects a quick 200; billing through PayPal can take longer. Reply with a new message afterwards.
    runAfterResponse(async () => {
      try {
        await rememberShop(msg.from);
        if (!isAudio && !text) {
          await sendWhatsApp(msg.from, "Tuma ujumbe wa sauti au maandishi.\n\n_EN: Send a voice note or a text message._");
          return;
        }
        if (isAudio && process.env.WHATSAPP_ACK !== "false") {
          await sendWhatsApp(msg.from, "⏳ Nimesikia, naandika…\n_EN: Got it, writing it down…_");
        }
        const result = isAudio
          ? await (async () => {
              const media = await downloadMedia(msg.audio!.id);
              return runAgent({ kind: "audio", data: media.data, mimeType: media.mimeType });
            })()
          : await runAgent({ kind: "text", text });
        await sendWhatsApp(msg.from, formatReply(result.reply, result.transcript));
      } catch (err) {
        console.error("[whatsapp]", err);
        await sendWhatsApp(
          msg.from,
          "Samahani, kuna tatizo. Jaribu tena baada ya muda mfupi.\n\n_EN: Something went wrong on Sauti's side. Try again in a moment._",
        );
      }
    });
  }

  return NextResponse.json({ ok: true });
}
