import { BASE, accessToken } from "./paypal";
import { cancelTopup, openInvoices, settleInvoice, settleTopup, unbillInvoice } from "./ledger";
import { notifyShop } from "./notify";

// PayPal is the source of truth for whether money has arrived. Webhooks normally tell us at once,
// but a webhook can be missed (for example while a free server is asleep), so Sauti can also ask
// PayPal directly for the status of every request still open, and catch up.

const PAID = new Set(["PAID", "MARKED_AS_PAID"]);
const GONE = new Set(["CANCELLED"]);

async function invoiceStatus(id: string): Promise<string | null> {
  const res = await fetch(`${BASE}/v2/invoicing/invoices/${id}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) return null;
  return ((await res.json()) as { status?: string }).status ?? null;
}

export type CheckedInvoice = Awaited<ReturnType<typeof openInvoices>>[number] & {
  paypalStatus: string | null;
  updated?: "paid" | "cancelled";
};

/** Ask PayPal about every open request; settle or cancel anything that changed. */
export async function syncWithPayPal(): Promise<CheckedInvoice[]> {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return [];
  const open = await openInvoices();
  const checked: CheckedInvoice[] = [];
  for (const inv of open) {
    let paypalStatus: string | null = null;
    try {
      paypalStatus = await invoiceStatus(inv.invoiceId);
    } catch {
      /* PayPal unreachable: report as unknown */
    }
    const row: CheckedInvoice = { ...inv, paypalStatus };
    if (paypalStatus && PAID.has(paypalStatus)) {
      // Settling is idempotent: if the webhook already did it, this returns null and nobody is told twice.
      const notice = (await settleTopup(inv.invoiceId)) ?? (await settleInvoice(inv.invoiceId));
      if (notice) {
        notifyShop(notice);
        row.updated = "paid";
      }
    } else if (paypalStatus && GONE.has(paypalStatus)) {
      if (await cancelTopup(inv.invoiceId)) row.updated = "cancelled";
      else if (await unbillInvoice(inv.invoiceId)) row.updated = "cancelled";
    }
    checked.push(row);
  }
  return checked;
}

// The ledger page polls every few seconds; check PayPal at most this often from there.
let lastBackgroundSync = 0;
export async function maybeSyncWithPayPal(everyMs = 30000) {
  if (Date.now() - lastBackgroundSync < everyMs) return;
  lastBackgroundSync = Date.now();
  try {
    if ((await openInvoices()).length) await syncWithPayPal();
  } catch (err) {
    console.error("[paypal-sync]", err);
  }
}
