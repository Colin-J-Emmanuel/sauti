import { NextResponse } from "next/server";
import { runAfterResponse, sendWhatsApp, shopNumber, whatsappEnabled } from "@/lib/whatsapp";
import { verifyWebhook } from "@/lib/paypal";
import {
  cancelTopup,
  markEventProcessed,
  settleInvoice,
  settleTopup,
  unbillInvoice,
  walletBalances,
  type PaymentNotice,
} from "@/lib/ledger";

export const runtime = "nodejs";

type PayPalEvent = { id: string; event_type: string; resource?: { id?: string; invoice?: { id?: string } } };

const tzs = (n: number) => `${Math.round(n).toLocaleString("en-US")} TZS`;

/** The WhatsApp message the shopkeeper gets when PayPal confirms a payment. */
async function paymentMessage(n: PaymentNotice) {
  const who = n.payer?.split(" (")[0] ?? "Familia";
  if (n.kind === "topup") {
    const balance = (await walletBalances())[n.customer] ?? 0;
    const cleared = n.clearedTzs ? ` Deni la ${tzs(n.clearedTzs)} limefutwa.` : "";
    const clearedEn = n.clearedTzs ? ` ${tzs(n.clearedTzs)} of old credit is cleared.` : "";
    return `💸 *${who} ameweka ${tzs(n.amountTzs)}* kwenye pochi ya ${n.customer} kupitia PayPal.${cleared} Salio la pochi: ${tzs(balance)}.\n\n_EN: ${n.payer ?? "Family abroad"} added ${tzs(n.amountTzs)} to ${n.customer}'s wallet with PayPal.${clearedEn} Wallet balance: ${tzs(balance)}._`;
  }
  return `💸 *${who} amelipa ${tzs(n.amountTzs)}* kwa ${n.customer} kupitia PayPal. Deni limefutwa.\n\n_EN: ${n.payer ?? "Family abroad"} paid ${n.customer}'s tab with PayPal. The tab is cleared._`;
}

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
      if (notice && whatsappEnabled()) {
        runAfterResponse(async () => {
          const to = await shopNumber();
          if (to) await sendWhatsApp(to, await paymentMessage(notice));
        });
      }
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
