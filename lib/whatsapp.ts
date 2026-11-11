import { createHmac, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { after } from "next/server";
import { logChat, type ChatMessage } from "./chatlog";

// WhatsApp via Meta's WhatsApp Cloud API (free test number, up to 5 verified recipients).
//   WHATSAPP_TOKEN            — access token (temporary 24h one from API Setup, or a System User token)
//   WHATSAPP_PHONE_NUMBER_ID  — the test number's Phone Number ID (not the WABA ID)
//   WHATSAPP_VERIFY_TOKEN     — any string you choose; typed into Meta's webhook settings too
//   WHATSAPP_APP_SECRET       — App settings → Basic → App secret; used to check Meta's signature
//   WHATSAPP_GRAPH_VERSION    — optional, default v25.0
//   SHOP_WHATSAPP_TO          — optional; the shopkeeper's number. Defaults to whoever last messaged Sauti.

const TOKEN = () => process.env.WHATSAPP_TOKEN ?? "";
const PHONE_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const GRAPH = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v25.0"}`;

export const whatsappEnabled = () => !!(TOKEN() && PHONE_ID());

/** Meta signs every webhook body: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody). */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  if (process.env.SKIP_WHATSAPP_VERIFY === "true") return true; // local testing only
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Voice notes arrive as a media id: look up its URL, then download it (both need the token). */
export async function downloadMedia(mediaId: string): Promise<{ data: Uint8Array; mimeType: string }> {
  const auth = { Authorization: `Bearer ${TOKEN()}` };
  const meta = await fetch(`${GRAPH()}/${mediaId}`, { headers: auth });
  if (!meta.ok) throw new Error(`Couldn't find the voice note (${meta.status}): ${await meta.text()}`);
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type?: string };
  const file = await fetch(url, { headers: auth });
  if (!file.ok) throw new Error(`Couldn't download the voice note (${file.status})`);
  return { data: new Uint8Array(await file.arrayBuffer()), mimeType: mime_type ?? "audio/ogg" };
}

/** Send a WhatsApp text. Free-form text works within 24h of the shopkeeper's last message. */
export async function sendWhatsApp(to: string, body: string, kind: ChatMessage["kind"] = "reply") {
  const res = await fetch(`${GRAPH()}/${PHONE_ID()}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/^\+/, ""),
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) },
    }),
  });
  if (!res.ok) console.error("[whatsapp] send failed", res.status, await res.text());
  // Mirror it on the demo screen (even if delivery failed, it shows what Sauti said).
  await logChat({ from: "sauti", kind, text: body }).catch(() => undefined);
}

// Remember who the shopkeeper is, so a PayPal payment can be announced back to them on WhatsApp.
const FILE = path.join(process.cwd(), "data", "whatsapp.json");

export async function rememberShop(from: string) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ lastFrom: from, at: new Date().toISOString() }));
}

export async function shopNumber(): Promise<string | null> {
  if (process.env.SHOP_WHATSAPP_TO) return process.env.SHOP_WHATSAPP_TO;
  try {
    return (JSON.parse(await fs.readFile(FILE, "utf8")) as { lastFrom: string }).lastFrom;
  } catch {
    return null;
  }
}

/** Format an agent result as a WhatsApp message: what Sauti heard, then the Swahili reply, then the English line. */
export function formatReply(reply: string, transcript?: string) {
  const [sw, ...rest] = reply.split(/\n?\s*EN:\s*/);
  const en = rest.join(" ").trim();
  return [transcript ? `🎙 _"${transcript}"_` : "", sw.trim(), en ? `_EN: ${en}_` : ""].filter(Boolean).join("\n\n");
}

/** Run work after the HTTP response is sent (inside Next); in scripts/tests, just run it. */
export function runAfterResponse(fn: () => Promise<void>) {
  try {
    after(fn);
  } catch {
    void fn();
  }
}
