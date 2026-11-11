import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type Tool } from "ai";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";
import { appendTurn, loadHistory } from "./history";
import { recordActivity } from "./activity";
import { syncWithPayPal } from "./paypal-sync";
import { AGENT_MODELS, languageModel, transcribeVoiceNote } from "./models";
import {
  openInvoices,
  recordTabSale,
  registerTopup,
  walletStatus,
} from "./ledger";
import { activeEntries, addEntry, canonicalCustomerName, listContacts, attachInvoice, balances, unbilledTab, voidEntries } from "./ledger";

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
      execute: async (input: unknown) => {
        // Never set an invoice date: PayPal's sandbox runs on US time, so "today" in Dar es Salaam
        // can be "tomorrow" for PayPal, which turns the invoice into an unpayable *scheduled* one.
        // Leaving the date out makes PayPal use its own today, so the invoice is payable at once.
        if (name === "create_invoice" && input && typeof input === "object") {
          const { invoice_date: _drop, ...rest } = input as Record<string, unknown>;
          const detail = rest.detail as Record<string, unknown> | undefined;
          if (detail && typeof detail === "object") {
            const { invoice_date: _d, ...detailRest } = detail;
            rest.detail = detailRest;
          }
          input = rest;
        }
        return legacy.execute(input, {});
      },
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
      "Save one transaction to the trader's ledger. Call once per transaction the trader mentions. For goods a customer takes without paying cash (credit_sale), the customer's family wallet pays automatically if it has money and the rest goes on credit; the result tells you what happened and may include request_topup_now.",
    inputSchema: z.object({
      type: z
        .enum(["credit_sale", "payment_received", "cash_sale", "expense"])
        .describe(
          "credit_sale = customer took goods without paying cash (amechukua / anadaiwa / amekopa / kwa mkopo); payment_received = customer paid back; cash_sale = paid on the spot; expense = trader bought stock or paid someone",
        ),
      counterparty: z.string().describe("Customer or supplier name as spoken, e.g. 'Mama Asha'"),
      item: z.string().optional().describe("What was sold or bought, in Swahili as spoken"),
      amount: z.number().positive(),
      currency: z.enum(["TZS", "USD"]).describe("Default TZS unless dollars are mentioned"),
      note: z.string().optional(),
    }),
    execute: async (args) => {
      // Snap near-miss names from speech-to-text ("Mama Hasha") to the known customer ("Mama Asha").
      const counterparty = await canonicalCustomerName(args.counterparty);
      // Goods taken on the tab: the family wallet pays if it has money; the rest goes on credit.
      if (args.type === "credit_sale" && args.currency === "TZS")
        return recordTabSale({ counterparty, item: args.item, amount: args.amount, note: args.note }, TZS_PER_USD);
      return addEntry({ ...args, counterparty });
    },
  }),

  get_wallet: tool({
    description:
      "A customer's family wallet (pochi ya familia): balance, what they still owe, top-up requests waiting to be paid, the relative abroad who funds it, a suggested top-up, and their payment record (how many PayPal requests the family has paid and how fast). Use for 'pochi ya X ina kiasi gani?', before asking a relative to top up, and for 'naweza kumkopesha X?' (can I give X credit?). Accepts the customer's or the relative's name.",
    inputSchema: z.object({ customer: z.string() }),
    execute: async ({ customer }) => walletStatus(customer, TZS_PER_USD),
  }),

  link_topup_invoice: tool({
    description:
      "After creating and sending a PayPal invoice that asks a relative to top up a customer's wallet, register it so the wallet is credited when PayPal confirms payment.",
    inputSchema: z.object({ customer: z.string(), amountTzs: z.number().positive(), invoiceId: z.string() }),
    execute: async ({ customer, amountTzs, invoiceId }) => registerTopup(customer, amountTzs, invoiceId, TZS_PER_USD),
  }),

  open_invoices: tool({
    description:
      "Asks PayPal for the live status of every open request (wallet top-ups and tab bills): invoice id, customer, relative, amount, days waiting and PayPal's status. Anything PayPal reports as paid or cancelled is settled on the spot (updated: 'paid' / 'cancelled'). Use for 'nani hajalipa?' (who hasn't paid?), 'Juma amelipa?' (has Juma paid?), and to find the invoice id before sending a reminder.",
    inputSchema: z.object({}),
    execute: async () => {
      const checked = await syncWithPayPal();
      // Without PayPal credentials (local tests), fall back to the ledger's own view.
      return checked.length || process.env.PAYPAL_CLIENT_ID ? checked : openInvoices();
    },
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
      "Get a customer's unbilled credit purchases, already converted to USD, and the relative abroad who pays for them (payer). Call before creating a family-tab invoice. Accepts the customer's name OR the relative's name (e.g. 'Juma' returns Mama Asha's tab).",
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

Context: many customers' groceries are paid for by a relative abroad (a son in New York, a granddaughter in Houston) using PayPal.
Each such customer has a family wallet (pochi ya familia): the relative puts money in through PayPal, purchases draw it down,
and the shop is paid up front instead of carrying credit. Diaspora money goes straight to the family's groceries instead of
through a remittance. The trader withdraws PayPal funds to M-Pesa. PayPal is how money moves here: you request it, chase it and confirm it.

Rules:
- Every sale, payment or expense the trader mentions → call record_entry (one call per transaction).
  The counterparty is the customer at the shop (e.g. "Mama Asha"), never the relative abroad.
  When a customer takes goods ("amechukua", with or without "kwa mkopo") use credit_sale: the wallet pays what it can, the rest is credit.
  In your reply say what the wallet paid, what went on credit, and the wallet balance left.
- Keeping the wallet funded is YOUR job. If a record_entry result contains request_topup_now, do it in the same turn without asking:
  1. create_invoice: currency_code "USD"; recipient = request_topup_now.payer email and name; ONE line item named
     "Pochi ya familia / Family grocery wallet – <amountTzs> TZS", quantity 1, unit amount = request_topup_now.usd.
     invoicer_business_name: "Duka la Mzee Salim". Do not set invoice_date or due dates. note (in English, for the relative):
     "Grocery wallet top-up for <customer> at Duka la Mzee Salim, Dar es Salaam." plus, if she owes anything,
     "<owedTzs> TZS she already owes is cleared first; the rest pays for her next purchases." plus "Paid directly to the shop."
  2. send_invoice with the new invoice id.
  3. link_topup_invoice with the customer, amountTzs and invoice id.
  Send at most ONE top-up request per customer per turn, and none if topupAlreadyRequested is true. Tell the trader you asked the relative.
- If the trader asks you to request money for a wallet ("mwombe Juma aweke pesa", "jaza pochi"): get_wallet, then the same three steps
  (use the amount the trader said, otherwise suggestedTopup). If payer is null, say nobody abroad is linked and stop.
- Wallet questions ("pochi ya Mama Asha ina kiasi gani?") → get_wallet.
- "Naweza kumkopesha X?" (can I give X credit?) → get_wallet and advise from paymentRecord and what is owed: say how many PayPal requests
  the family has paid and how quickly. Be honest when there is no record yet.
- "Nani hajalipa?" (who hasn't paid?) or "Juma amelipa?" → open_invoices, which checks with PayPal. Say what PayPal reports, including anything it just found paid.
  To remind someone ("mkumbushe Juma") → open_invoices for the invoice id, then send_invoice_reminder with that invoice id
  (a short note in English, e.g. "A friendly reminder from Duka la Mzee Salim about Mama Asha's grocery wallet."). If nothing is open, say there is nothing to remind.
- Sauti only REQUESTS money from relatives abroad; it cannot send money out, pay suppliers or give change. If asked to send or pay money
  ("tuma pesa kwa…", "mlipe…"), say plainly that Sauti can't send money yet, and offer what it can do (record it, or request money). Never
  create an invoice to the person the trader wants to pay.
- If a tool or PayPal returns an error, tell the trader plainly what failed and that nothing was sent; never claim success.
- The trader can still bill the exact tab instead of a top-up ("tuma bili", "mdai", "tuma ankara"):
  1. get_family_tab for that customer. If payer is null, tell the trader nobody abroad is linked to that customer and stop. If there are no entries, say the tab is clear.
  2. create_invoice: currency_code "USD"; recipient = the payer's email and name; one line item per entry,
     item name like "Mchele / Rice – 15,000 TZS (2026-11-08)", quantity 1, unit amount = its usd value.
     invoicer_business_name: "Duka la Mzee Salim". Do not set invoice_date or due dates. note (in English, for the relative):
     "Groceries for <customer> at Duka la Mzee Salim, Dar es Salaam. Total <totalTzs> TZS. Paid directly to the shop."
  3. send_invoice with the new invoice id so the relative receives it.
  4. link_invoice_to_entries with all entryIds and the invoice id.
- Never invent amounts or names. If the amount or person is unclear, ask one short question instead of guessing.

- Before recording, check the conversation: if a sale was already recorded (you can see the record_entry result), do NOT record it again.
- If the trader says an entry is wrong or duplicated, find it with recent_entries and remove it with remove_entries, then record the correct one if needed.
- Follow-ups refer to earlier turns ("pia amechukua…" = also took, "mwanawe" = her son): use the conversation so far to know who is meant.

- Voice notes arrive already transcribed and may contain small transcription errors (e.g. numbers as words: "elfu kumi na tano" = 15,000). Interpret sensibly; if an amount or name is genuinely unclear, ask.

Reply format (always, plain text, no markdown):
First: a short, warm confirmation in Swahili of what you did (amounts in TZS as the trader said them).
Last line: "EN: " followed by the English translation.`;

/** Tell the model which customers exist, so it can spell names right even when transcription slips. */
async function customersNote(): Promise<string> {
  const contacts = await listContacts();
  if (!contacts.length) return "";
  const lines = contacts.map((c) =>
    `- ${c.name}${c.aliases.length ? ` (also: ${c.aliases.join(", ")})` : ""}${c.payer ? ` — wallet funded by ${c.payer.relation} ${c.payer.name} in ${c.payer.city}` : " — no relative abroad, pays at the shop"}`,
  );
  return `\n\nKnown customers (use these exact spellings; a voice note may mishear names, e.g. "Mama Hasha" = Mama Asha):\n${lines.join("\n")}`;
}

export type AgentInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; data: Uint8Array; mimeType: string };

export async function runAgent(
  input: AgentInput,
  opts: { model?: LanguageModel; source?: "app" | "whatsapp" } = {},
) {
  // Voice notes are transcribed first (ElevenLabs Scribe), then handled exactly like typed text.
  const transcript =
    input.kind === "audio" ? await transcribeVoiceNote(input.data) : undefined;
  const userText = input.kind === "text" ? input.text : transcript!;
  if (!userText) {
    return { reply: "Samahani, sikusikia vizuri. Tafadhali rudia.\nEN: Sorry, I didn't catch that. Please say it again.", actions: [], transcript };
  }

  const history = await loadHistory();
  const system = SYSTEM + (await customersNote());
  const run = (model: LanguageModel, onStep: () => void) =>
    generateText({
      model,
      system,
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
  await recordActivity({ source: opts.source ?? "app", said: userText, spoken: input.kind === "audio", reply: result.text, actions });

  return { reply: result.text, actions, transcript };
}
