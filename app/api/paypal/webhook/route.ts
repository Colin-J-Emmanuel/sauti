import { NextResponse } from "next/server";
import { runAfterResponse, sendWhatsApp, shopNumber, whatsappEnabled } from "@/lib/whatsapp";
import { verifyWebhook } from "@/lib/paypal";
import { markEventProcessed, settleInvoice, unbillInvoice } from "@/lib/ledger";

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
    case "INVOICING.INVOICE.PAID":
    {
      const notice = await settleInvoice(invoiceId);
      // Tell the shopkeeper on WhatsApp too (after answering PayPal, so a slow message never delays the webhook).
      if (notice && whatsappEnabled()) {
        runAfterResponse(async () => {
          const to = await shopNumber();
          if (!to) return;
          const who = notice.payer?.split(" (")[0] ?? "Familia";
          await sendWhatsApp(
            to,
            `💸 *${who} amelipa ${notice.amountTzs.toLocaleString("en-US")} TZS* kwa ${notice.customer} kupitia PayPal. Deni limefutwa.\n\n_EN: ${notice.payer ?? "Family abroad"} paid ${notice.customer}'s tab with PayPal. The tab is cleared._`,
          );
        });
      }
      return NextResponse.json({ ok: true, notice });
    }
    case "INVOICING.INVOICE.CANCELLED":
      return NextResponse.json({ ok: true, unbilled: await unbillInvoice(invoiceId) });
    default:
      return NextResponse.json({ ok: true, ignored: event.event_type });
  }
}
