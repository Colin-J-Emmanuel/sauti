import { NextResponse } from "next/server";
import { lastActivity } from "@/lib/activity";
import { chatMessages } from "@/lib/chatlog";
import { maybeSyncWithPayPal } from "@/lib/paypal-sync";
import {
  activeEntries,
  balances,
  latestNotices,
  listContacts,
  listTopups,
  walletBalances,
  WALLET_LOW_TZS,
} from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  // Catch up with PayPal in the background, in case a payment webhook was missed.
  void maybeSyncWithPayPal();
  const contacts = await listContacts();
  return NextResponse.json({
    entries: (await activeEntries()).reverse(),
    balances: await balances(),
    wallets: await walletBalances(),
    topups: (await listTopups()).filter((t) => !t.cancelledAt).reverse(),
    walletLowTzs: WALLET_LOW_TZS,
    notices: await latestNotices(),
    activity: await lastActivity(),
    whatsapp: await chatMessages(),
    // Names and who pays each tab. Emails stay on the server.
    customers: contacts.map((c) => ({
      name: c.name,
      payer: c.payer ? { name: c.payer.name, relation: c.payer.relation, city: c.payer.city } : null,
    })),
    tzsPerUsd: Number(process.env.TZS_PER_USD ?? 2500),
  });
}
