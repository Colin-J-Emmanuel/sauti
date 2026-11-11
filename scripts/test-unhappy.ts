// Unhappy paths against the real model, PayPal sandbox and your local ledger.
// Usage: npm run test:unhappy
// Creates one real sandbox top-up request (for Bibi Rehema / Neema). Each case starts a fresh conversation.
import "dotenv/config";
import { runAgent } from "../lib/agent";
import { clearHistory } from "../lib/history";

type Case = { say: string; what: string; expect: (tools: string[], reply: string) => boolean; rule: string };

const cases: Case[] = [
  {
    say: "Baraka amechukua soda ya 1,000.",
    what: "Customer with no relative abroad",
    rule: "records the sale, sends no PayPal request",
    expect: (t) => t.includes("record_entry") && !t.includes("create_invoice"),
  },
  {
    say: "Mama Asha amechukua mchele.",
    what: "Sale with no amount",
    rule: "asks for the amount, records nothing",
    expect: (t) => !t.includes("record_entry"),
  },
  {
    say: "Tuma bili kwa Baraka.",
    what: "Bill a customer nobody abroad pays for",
    rule: "says nobody is linked, sends nothing",
    expect: (t) => !t.includes("create_invoice"),
  },
  {
    say: "Tuma shilingi 100,000 kwa Juma.",
    what: "Asks Sauti to send money out (not supported)",
    rule: "explains it can't, sends nothing",
    expect: (t) => !t.includes("create_invoice") && !t.includes("send_invoice"),
  },
  {
    say: "Bibi Rehema took two loaves of bread for 3,000 on credit.",
    what: "English instead of Swahili",
    rule: "records it and asks Neema for a top-up by itself",
    expect: (t) => t.includes("record_entry") && t.includes("create_invoice") && t.includes("send_invoice") && t.includes("link_topup_invoice"),
  },
  {
    say: "Nani hajalipa?",
    what: "Who hasn't paid",
    rule: "asks PayPal (open_invoices)",
    expect: (t) => t.includes("open_invoices"),
  },
  {
    say: "Mkumbushe Neema.",
    what: "Remind the relative",
    rule: "sends a PayPal reminder",
    expect: (t) => t.includes("send_invoice_reminder"),
  },
  {
    say: "Futa ile soda ya Baraka, nimekosea.",
    what: "Correct a mistake",
    rule: "removes the entry",
    expect: (t) => t.includes("remove_entries"),
  },
];

async function main() {
  for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY"]) {
    if (!process.env[k]) throw new Error(`Missing ${k} in .env`);
  }
  let passed = 0;
  for (const c of cases) {
    await clearHistory();
    const { reply, actions } = await runAgent({ kind: "text", text: c.say });
    const tools = actions.map((a) => a.tool);
    const ok = c.expect(tools, reply);
    if (ok) passed++;
    console.log(`\n${ok ? "✅" : "❌"} ${c.what}: "${c.say}"`);
    console.log(`   expected: ${c.rule}`);
    console.log(`   tools:    ${tools.join(" → ") || "(none)"}`);
    console.log(`   reply:    ${reply.replace(/\n+/g, " / ").slice(0, 300)}`);
  }
  console.log(`\n${passed}/${cases.length} behaved as expected`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
