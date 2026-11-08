// Thin REST helpers for the parts the Agent Toolkit doesn't cover (webhook verification).
const BASE = "https://api-m.sandbox.paypal.com";

let cached: { token: string; expires: number } | null = null;

export async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expires) return cached.token;
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early (tokens expire; the hackathon webinar flagged this).
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return cached.token;
}

/** Ask PayPal whether this webhook really came from PayPal. */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  if (process.env.SKIP_WEBHOOK_VERIFY === "true") return true; // local curl testing only
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");
  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!res.ok) return false;
  return ((await res.json()) as { verification_status: string }).verification_status === "SUCCESS";
}
