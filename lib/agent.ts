import { generateText, tool, type CoreMessage } from "ai";
import { google } from "@ai-sdk/google";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";
import { addEntry, attachInvoice, balances, listEntries, unbilledTab } from "./ledger";

const TZS_PER_USD = Number(process.env.TZS_PER_USD ?? 2500);

let paypal: PayPalAgentToolkit | null = null;
function paypalTools() {
  paypal ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      // Only what the ledger needs: invoices. Keeps the model focused.
      actions: {
        invoices: {
          create: true,
          send: true,
          list: true,
          get: true,
          sendReminder: true,
          generateQRC: true,
        },
      },
      context: { sandbox: true },
    },
  });
  return paypal.getTools();
}

const ledgerTools = {
  record_entry: tool({
    description:
      "Save one transaction to the trader's ledger. Call once per transaction the trader mentions.",
    parameters: z.object({
      type: z
        .enum(["credit_sale", "payment_received", "cash_sale", "expense"])
        .describe(
          "credit_sale = customer took goods and owes money (anadaiwa / amekopa); payment_received = customer paid back; cash_sale = paid on the spot; expense = trader bought stock or paid someone",
        ),
      counterparty: z.string().describe("Customer or supplier name as spoken, e.g. 'Mama Asha'"),
      item: z.string().optional().describe("What was sold or bought, in Swahili as spoken"),
      amount: z.number().positive(),
      currency: z.enum(["TZS", "USD"]).describe("Default TZS unless dollars are mentioned"),
      note: z.string().optional(),
    }),
    execute: async (args) => addEntry(args),
  }),

  get_balances: tool({
    description:
      "Who owes the trader money and how much. Use for questions like 'nani ananidai?' or 'Asha anadaiwa kiasi gani?'",
    parameters: z.object({}),
    execute: async () => balances(),
  }),

  recent_entries: tool({
    description: "The most recent ledger entries, newest first.",
    parameters: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
    execute: async ({ limit }) => (await listEntries()).slice(-limit).reverse(),
  }),

  get_family_tab: tool({
    description:
      "Get a customer's unbilled credit purchases, already converted to USD, and the relative abroad who pays for them (payer). Call before creating a family-tab invoice.",
    parameters: z.object({ customer: z.string() }),
    execute: async ({ customer }) => unbilledTab(customer, TZS_PER_USD),
  }),

  link_invoice_to_entries: tool({
    description:
      "After creating and sending a PayPal invoice, mark the ledger entries it covers as billed.",
    parameters: z.object({ entryIds: z.array(z.string()), invoiceId: z.string() }),
    execute: async ({ entryIds, invoiceId }) => attachInvoice(entryIds, invoiceId),
  }),
};

const SYSTEM = `You are Sauti, a bookkeeping assistant for small shopkeepers (duka owners, mama lishe, market sellers) in Tanzania.
The trader talks to you in Swahili (sometimes mixed with English). Judges may also type in English: handle it the same way. You keep their ledger in Tanzanian shillings.

Context: many customers buy on credit and their tab is paid by a relative abroad (a son in New York, a granddaughter in Houston).
Those relatives pay with PayPal. You bill the relative directly, so diaspora money goes straight to the shop for the family's groceries
instead of through a remittance. The trader withdraws PayPal funds to M-Pesa.

Rules:
- Every sale, credit sale, payment or expense the trader mentions → call record_entry (one call per transaction).
  The counterparty is the customer at the shop (e.g. "Mama Asha"), never the relative abroad.
- When the trader asks to bill the family / send the bill abroad ("mtumie bili mwanawe", "tuma bili Marekani", "mdai", "tuma ankara"):
  1. get_family_tab for that customer. If payer is null, tell the trader nobody abroad is linked to that customer and stop. If there are no entries, say the tab is clear.
  2. create_invoice: currency_code "USD"; recipient = the payer's email and name; one line item per entry,
     item name like "Mchele / Rice – 15,000 TZS (2026-11-08)", quantity 1, unit amount = its usd value.
     invoicer_business_name: "Duka la Mzee Salim". note (in English, for the relative):
     "Groceries for <customer> at Duka la Mzee Salim, Dar es Salaam. Total <totalTzs> TZS. Paid directly to the shop."
  3. send_invoice with the new invoice id so the relative receives it.
  4. link_invoice_to_entries with all entryIds and the invoice id.
- For reminders on an existing invoice, use send_invoice_reminder.
- Never invent amounts or names. If the amount or person is unclear, ask one short question instead of guessing.

Reply format (always):
Line 1: a short, warm confirmation in Swahili of what you did (amounts in TZS as the trader said them).
Line 2: "EN: " followed by the English translation.`;

export type AgentInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; data: Uint8Array; mimeType: string };

export async function runAgent(input: AgentInput) {
  const userContent: CoreMessage["content"] =
    input.kind === "text"
      ? [{ type: "text", text: input.text }]
      : [
          {
            type: "text",
            text: "The trader sent this voice note. First write what they said, then act on it.",
          },
          { type: "file", data: input.data, mimeType: input.mimeType },
        ];

  const result = await generateText({
    model: google("gemini-2.5-flash"),
    system: SYSTEM,
    messages: [{ role: "user", content: userContent } as CoreMessage],
    tools: { ...ledgerTools, ...paypalTools() },
    maxSteps: 10,
  });

  const actions = result.steps.flatMap((s) =>
    s.toolCalls.map((c, i) => ({
      tool: c.toolName,
      args: c.args,
      result: s.toolResults[i]?.result,
    })),
  );

  return { reply: result.text, actions };
}
