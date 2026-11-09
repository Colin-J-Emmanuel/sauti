import { runAgent } from "@/lib/agent";
import { downloadMedia, formatReply, rememberShop, runAfterResponse, sendWhatsApp, verifyTwilioSignature } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

const twiml = (message?: string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message}</Message>` : ""}</Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );

/** The exact public URL Twilio called (Render sits behind a proxy), needed to check the signature. */
function publicUrl(req: Request) {
  if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

// Twilio calls this for every WhatsApp message sent to the sandbox number.
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));

  if (!verifyTwilioSignature(publicUrl(req), params, req.headers.get("x-twilio-signature"))) {
    return new Response("invalid signature", { status: 403 });
  }

  const from = params.From; // e.g. whatsapp:+1917…
  const text = (params.Body ?? "").trim();
  const isAudio = Number(params.NumMedia ?? 0) > 0 && (params.MediaContentType0 ?? "").startsWith("audio/");

  if (!from || (!text && !isAudio)) {
    return twiml("Tuma ujumbe wa sauti au maandishi. / Send a voice note or a text message.");
  }

  // WhatsApp gives a webhook ~15 seconds; billing through PayPal can take longer.
  // So: answer Twilio right away, do the work after the response, and reply with a new message.
  runAfterResponse(async () => {
    try {
      await rememberShop(from);
      const result = isAudio
        ? await (async () => {
            const media = await downloadMedia(params.MediaUrl0);
            return runAgent({ kind: "audio", data: media.data, mimeType: media.mimeType });
          })()
        : await runAgent({ kind: "text", text });
      await sendWhatsApp(from, formatReply(result.reply, result.transcript));
    } catch (err) {
      console.error("[whatsapp]", err);
      await sendWhatsApp(
        from,
        "Samahani, kuna tatizo. Jaribu tena baada ya muda mfupi.\n\n_EN: Something went wrong on Sauti's side. Try again in a moment._",
      );
    }
  });

  // A quick "on it" for voice notes, since transcribing adds a few seconds.
  // Costs one message each; set WHATSAPP_ACK=false to save trial messages.
  const ack = isAudio && process.env.WHATSAPP_ACK !== "false";
  return twiml(ack ? "⏳ Nimesikia, naandika… / Got it, writing it down…" : undefined);
}
