// Smoke test: Swahili text in → ledger entries + a real sandbox PayPal invoice to the relative abroad.
// Usage:
//   npm run test:agent                       (runs the full demo sequence)
//   npm run test:agent -- "Baraka amelipa 5,000"
import "dotenv/config";
import { runAgent } from "../lib/agent";

for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
  if (!process.env[k]) throw new Error(`Missing ${k} in .env`);
}

const custom = process.argv.slice(2).join(" ");
const turns = custom
  ? [custom]
  : [
      "Mama Asha amechukua mchele kilo tano wa shilingi 15,000 na mafuta ya 8,000 kwa mkopo.",
      "Pia amechukua sukari ya 4,500.",
      "Mama Asha anadaiwa kiasi gani?",
      "Sawa, tuma bili kwa mwanawe Marekani.",
    ];

async function main() {
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
