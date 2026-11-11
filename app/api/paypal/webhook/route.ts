import { NextResponse } from "next/server";
import { notifyShop } from "@/lib/notify";
import { verifyWebhook } from "@/lib/paypal";
import {
  cancelTopup,
  markEventProcessed,
  settleInvoice,
  settleTopup,
  unbillInvoice,
} from "@/lib/ledger";

export const runtime = "nodejs";

type PayPalEvent = { id: string; event_type: string; resource?: { id?: string; invoice?: { id?: string } } };

// "Don't poll. Let PayPal tell you." PayPal calls this when an invoice changes state.
export async function POST(req: Request) {
  const event = (await req.json()) as PayPalEvent;

  if (!(await verifyWebhook(req.headers, event))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  // PayPal retries until it gets a 2xx, so duplicates are normal: ack them and do nothing.
  if (!(await markEventProcessed(event.id))) return NextResponse.json({ ok: true, duplicate: true });

  const invoiceId = event.resource?.id ?? event.resource?.invoice?.id;
  if (!invoiceId) return NextResponse.json({ ok: true, ignored: "no invoice id" });

  switch (event.event_type) {
    case "INVOICING.INVOICE.PAID": {
      // A paid invoice is either a wallet top-up or a bill for a specific tab.
      const notice = (await settleTopup(invoiceId)) ?? (await settleInvoice(invoiceId));
      // Tell the shopkeeper on WhatsApp too (after answering PayPal, so a slow message never delays the webhook).
      if (notice) notifyShop(notice);
      return NextResponse.json({ ok: true, notice });
    }
    case "INVOICING.INVOICE.CANCELLED":
      return NextResponse.json({
        ok: true,
        ...((await cancelTopup(invoiceId)) ? { topupCancelled: true } : { unbilled: await unbillInvoice(invoiceId) }),
      });
    default:
      return NextResponse.json({ ok: true, ignored: event.event_type });
  }
}
