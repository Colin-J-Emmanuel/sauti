import { walletBalances, type PaymentNotice } from "./ledger";
import { sendWhatsApp, shopNumber, whatsappEnabled } from "./whatsapp";

const tzs = (n: number) => `${Math.round(n).toLocaleString("en-US")} TZS`;

/** The WhatsApp message the shopkeeper gets when PayPal confirms a payment. */
export async function paymentMessage(n: PaymentNotice) {
  const who = n.payer?.split(" (")[0] ?? "Familia";
  if (n.kind === "topup") {
    const balance = (await walletBalances())[n.customer] ?? 0;
    const cleared = n.clearedTzs ? ` Deni la ${tzs(n.clearedTzs)} limefutwa.` : "";
    const clearedEn = n.clearedTzs ? ` ${tzs(n.clearedTzs)} of old credit is cleared.` : "";
    return `💸 *${who} ameweka ${tzs(n.amountTzs)}* kwenye pochi ya ${n.customer} kupitia PayPal.${cleared} Salio la pochi: ${tzs(balance)}.\n\n_EN: ${n.payer ?? "Family abroad"} added ${tzs(n.amountTzs)} to ${n.customer}'s wallet with PayPal.${clearedEn} Wallet balance: ${tzs(balance)}._`;
  }
  return `💸 *${who} amelipa ${tzs(n.amountTzs)}* kwa ${n.customer} kupitia PayPal. Deni limefutwa.\n\n_EN: ${n.payer ?? "Family abroad"} paid ${n.customer}'s tab with PayPal. The tab is cleared._`;
}

/** Tell the shopkeeper on WhatsApp, in the background so it never slows PayPal or the page down.
 *  (Not Next's after(): the background PayPal check runs once the ledger response has already gone,
 *  where after() silently does nothing. The server stays up, so a plain background task is safe.) */
export function notifyShop(n: PaymentNotice) {
  if (!whatsappEnabled()) return;
  void (async () => {
    const to = await shopNumber();
    if (!to) return console.warn("[notify] no shopkeeper number yet; message Sauti on WhatsApp once first");
    await sendWhatsApp(to, await paymentMessage(n), "alert");
  })().catch((err) => console.error("[notify]", err));
}
