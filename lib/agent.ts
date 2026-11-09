import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type Tool } from "ai";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";
import { appendTurn, loadHistory } from "./history";
import { AGENT_MODELS, languageModel, transcribeVoiceNote } from "./models";
import { activeEntries, addEntry, attachInvoice, balances, unbilledTab, voidEntries } from "./ledger";

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
  // The toolkit is built on an older AI SDK (v4: `parameters`). Re-wrap each tool for the
  // current SDK (`inputSchema`), which every current model provider expects.
  const wrapped: Record<string, Tool> = {};
  for (const [name, t] of Object.entries(paypal.getTools())) {
    const legacy = t as unknown as {
      description?: string;
      parameters: z.ZodTypeAny;
      execute: (args: unknown, opts?: unknown) => Promise<unknown>;
    };
    wrapped[name] = tool({
      description: legacy.description,
      inputSchema: legacy.parameters,
      execute: async (input: unknown) => legacy.execute(input, {}),
    });
  }
  return wrapped;
}

type ApiErr = { statusCode?: number; isRetryable?: boolean };

/**
 * Worth trying the next model if ANY attempt was temporary (overloaded incl. Anthropic's 529, rate-limited,
 * dropped connection) or the model is gone (404). Retries can end on a different error
 * than they started with, so look at every attempt, not just the last one.
 */
function shouldFallBack(err: unknown): boolean {
  const e = err as ApiErr & { lastError?: ApiErr; errors?: ApiErr[] };
  const attempts = [e, e?.lastError, ...(e?.errors ?? [])].filter(Boolean) as ApiErr[];
  return attempts.some(
    (a) => a.isRetryable || [404, 429, 500, 503, 529].includes(a.statusCode ?? 0),
  );
}

const ledgerTools = {
  record_entry: tool({
    description:
      "Save one transaction to the trader's ledger. Call once per transaction the trader mentions.",
    inputSchema: z.object({
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
    inputSchema: z.object({}),
    execute: async () => balances(),
  }),

  recent_entries: tool({
    description: "The most recent ledger entries, newest first.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
    execute: async ({ limit }) => (await activeEntries()).slice(-limit).reverse(),
  }),

  remove_entries: tool({
    description:
      "Remove mistaken ledger entries (duplicates, wrong amount, wrong person) by id. Use when the trader says 'futa', 'nimekosea', 'si sahihi', or confirms removing duplicates you pointed out. Entries already on a PayPal invoice cannot be removed. Get ids from recent_entries.",
    inputSchema: z.object({ entryIds: z.array(z.string()).min(1) }),
    execute: async ({ entryIds }) => voidEntries(entryIds),
  }),

  get_family_tab: tool({
    description:
      "Get a customer's unbilled credit purchases, already converted to USD, and the relative abroad who pays for them (payer). Call before creating a family-tab invoice.",
    inputSchema: z.object({ customer: z.string() }),
    execute: async ({ customer }) => unbilledTab(customer, TZS_PER_USD),
  }),

  link_invoice_to_entries: tool({
    description:
      "After creating and sending a PayPal invoice, mark the ledger entries it covers as billed.",
    inputSchema: z.object({ entryIds: z.array(z.string()), invoiceId: z.string() }),
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

- Before recording, check the conversation: if a sale was already recorded (you can see the record_entry result), do NOT record it again.
- If the trader says an entry is wrong or duplicated, find it with recent_entries and remove it with remove_entries, then record the correct one if needed.
- Follow-ups refer to earlier turns ("pia amechukua…" = also took, "mwanawe" = her son): use the conversation so far to know who is meant.

- Voice notes arrive already transcribed and may contain small transcription errors (e.g. numbers as words: "elfu kumi na tano" = 15,000). Interpret sensibly; if an amount or name is genuinely unclear, ask.

Reply format (always, plain text, no markdown):
First: a short, warm confirmation in Swahili of what you did (amounts in TZS as the trader said them).
Last line: "EN: " followed by the English translation.`;

export type AgentInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; data: Uint8Array; mimeType: string };

export async function runAgent(input: AgentInput, opts: { model?: LanguageModel } = {}) {
  // Voice notes are transcribed first (ElevenLabs Scribe), then handled exactly like typed text.
  const transcript =
    input.kind === "audio" ? await transcribeVoiceNote(input.data) : undefined;
  const userText = input.kind === "text" ? input.text : transcript!;
  if (!userText) {
    return { reply: "Samahani, sikusikia vizuri. Tafadhali rudia.\nEN: Sorry, I didn't catch that. Please say it again.", actions: [], transcript };
  }

  const history = await loadHistory();
  const run = (model: LanguageModel, onStep: () => void) =>
    generateText({
      model,
      system: SYSTEM,
      messages: [
        ...history,
        { role: "user", content: userText },
      ],
      tools: { ...ledgerTools, ...paypalTools() },
      stopWhen: stepCountIs(10),
      maxRetries: 4, // waits longer between tries (exponential backoff) before giving up
      onStepFinish: onStep,
    });

  let result: Awaited<ReturnType<typeof run>> | undefined;
  if (opts.model) {
    result = await run(opts.model, () => {});
  } else {
    for (const [i, name] of AGENT_MODELS.entries()) {
      let stepsDone = 0;
      try {
        result = await run(languageModel(name), () => stepsDone++);
        break;
      } catch (err) {
        // Only switch models if nothing happened yet: retrying after a tool ran could record a sale twice.
        const last = i === AGENT_MODELS.length - 1;
        if (last || stepsDone > 0 || !shouldFallBack(err)) throw err;
        console.warn(`[sauti] ${name} unavailable, trying ${AGENT_MODELS[i + 1]}`);
      }
    }
  }
  if (!result) throw new Error("No model produced a result");

  const actions = result.steps.flatMap((s) =>
    s.toolCalls.map((c, i) => ({
      tool: c.toolName,
      args: c.input,
      result: s.toolResults[i]?.output,
    })),
  );

  await appendTurn([{ role: "user", content: userText }, ...result.responseMessages]);

  return { reply: result.text, actions, transcript };
}
