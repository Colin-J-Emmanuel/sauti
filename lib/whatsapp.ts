import { createHmac, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { after } from "next/server";

// WhatsApp via the Twilio WhatsApp Sandbox.
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  — from the Twilio Console
//   TWILIO_WHATSAPP_FROM                   — whatsapp:+14155238886 (the sandbox number)
//   SHOP_WHATSAPP_TO (optional)            — whatsapp:+1…  the shopkeeper; defaults to whoever last messaged Sauti

const SID = () => process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? "";
export const whatsappEnabled = () => !!(SID() && TOKEN() && process.env.TWILIO_WHATSAPP_FROM);

/**
 * Twilio signs every webhook: base64(HMAC-SHA1(authToken, fullUrl + sorted key/value pairs)).
 * Checking it means only real WhatsApp messages can write in the daftari.
 */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  if (process.env.SKIP_TWILIO_VERIFY === "true") return true; // local curl testing only
  if (!signature || !TOKEN()) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", TOKEN()).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Voice notes arrive as a Twilio media URL; downloading needs the account credentials. */
export async function downloadMedia(url: string): Promise<{ data: Uint8Array; mimeType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: "Basic " + Buffer.from(`${SID()}:${TOKEN()}`).toString("base64") },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Couldn't download the voice note (${res.status})`);
  return { data: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "audio/ogg" };
}

/** Send a WhatsApp message. Free-form text is allowed within 24h of the shopkeeper's last message. */
export async function sendWhatsApp(to: string, body: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${SID()}:${TOKEN()}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: process.env.TWILIO_WHATSAPP_FROM!, To: to, Body: body.slice(0, 1550) }),
  });
  if (!res.ok) console.error("[whatsapp] send failed", res.status, await res.text());
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
