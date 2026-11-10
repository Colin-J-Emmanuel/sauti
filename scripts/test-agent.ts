// Smoke test: Swahili text in → ledger entry + a real sandbox PayPal top-up request to the relative abroad.
// Usage:
//   npm run test:agent                       (runs the full demo sequence)
//   npm run test:agent -- "Baraka amelipa 5,000"
import "dotenv/config";
import { runAgent } from "../lib/agent";
import { clearHistory } from "../lib/history";

for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY"]) {
  if (!process.env[k]) throw new Error(`Missing ${k} in .env`);
}

const custom = process.argv.slice(2).join(" ");
const turns = custom
  ? [custom]
  : [
      "Mama Asha amechukua mchele wa shilingi 15,000.",
      "Pochi ya Mama Asha ina kiasi gani?",
      "Nani hajalipa?",
      "Naweza kumkopesha Mama Asha?",
    ];

async function main() {
if (!custom) await clearHistory(); // the demo sequence starts a fresh conversation
for (const text of turns) {
  console.log("\n> " + text);
  const { reply, actions } = await runAgent({ kind: "text", text });
  for (const a of actions) {
    console.log(`  🔧 ${a.tool}`, JSON.stringify(a.args).slice(0, 200));
    console.log("     →", JSON.stringify(a.result)?.slice(0, 200));
  }
  console.log(reply);
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
