import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type EntryType =
  | "credit_sale" // customer took goods, owes the trader
  | "payment_received" // customer paid (cash or PayPal)
  | "cash_sale" // paid on the spot
  | "expense" // trader paid a supplier / bought stock
  | "wallet_topup" // family abroad put money in the customer's wallet (PayPal)
  | "wallet_sale"; // purchase paid from the customer's prepaid wallet

export type LedgerEntry = {
  id: string;
  createdAt: string;
  type: EntryType;
  counterparty: string;
  item?: string;
  amount: number;
  currency: "TZS" | "USD";
  note?: string;
  transcript?: string;
  paypalInvoiceId?: string;
  billedAt?: string; // when it went onto a PayPal invoice
  paidAt?: string; // set when the PayPal invoice covering this entry is paid, or the wallet covered it
  fromCredit?: boolean; // was a credit sale, later cleared by a wallet top-up
  voidedAt?: string; // removed by the trader (duplicate / mistake); kept for the audit trail
};

/** A relative abroad who pays this customer's tab via PayPal. */
export type Payer = {
  name: string;
  relation: string; // e.g. "son", "daughter"
  email: string; // PayPal email (sandbox personal account for the demo)
  city: string; // e.g. "New York"
};

export type Contact = { name: string; aliases: string[]; payer?: Payer };

const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
const CONTACTS_FILE = path.join(DATA_DIR, "contacts.json");

// All writes go through one queue. The model can call several tools at once, and two
// read-modify-write cycles on the same JSON file would otherwise overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function listEntries(): Promise<LedgerEntry[]> {
  return readJson<LedgerEntry[]>(LEDGER_FILE, []);
}

/** Entries that count: everything the trader hasn't removed. */
export async function activeEntries(): Promise<LedgerEntry[]> {
  return (await listEntries()).filter((e) => !e.voidedAt);
}

/** Remove a mistaken entry. Billed or paid entries can't be removed (cancel the invoice instead). */
export async function voidEntries(ids: string[]) {
  return locked(async () => {
    const entries = await listEntries();
    const done: string[] = [];
    const refused: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const e = entries.find((x) => x.id === id);
      if (!e) refused.push({ id, reason: "not found" });
      else if (e.voidedAt) refused.push({ id, reason: "already removed" });
      else if (e.paypalInvoiceId) refused.push({ id, reason: "already on a PayPal invoice" });
      else {
        e.voidedAt = new Date().toISOString();
        done.push(id);
      }
    }
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));
    return { removed: done, refused };
  });
}

export async function addEntry(
  e: Omit<LedgerEntry, "id" | "createdAt">,
): Promise<LedgerEntry> {
  return locked(async () => {
    const entries = await listEntries();
    const entry: LedgerEntry = { ...e, id: randomUUID(), createdAt: new Date().toISOString() };
    entries.push(entry);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));
    return entry;
  });
}

export async function attachInvoice(entryIds: string[], invoiceId: string) {
  return locked(async () => {
    const entries = await listEntries();
    const updated = entries.filter((x) => entryIds.includes(x.id));
    const now = new Date().toISOString();
    updated.forEach((e) => {
      e.paypalInvoiceId = invoiceId;
      e.billedAt = now;
    });
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));
    return updated;
  });
}

/**
 * Everything on a customer's tab that hasn't been billed yet, plus who pays it abroad.
 * The agent turns this into one PayPal invoice ("family tab").
 */
export async function unbilledTab(customer: string, tzsPerUsd: number) {
  const contact = await findContact(customer);
  const name = contact?.name ?? customer;
  const keys = [name, ...(contact?.aliases ?? [])].map((s) => s.toLowerCase());
  const items = (await activeEntries()).filter(
    (e) =>
      e.type === "credit_sale" &&
      !e.paypalInvoiceId &&
      keys.some((k) => e.counterparty.toLowerCase().includes(k)),
  );
  const totalTzs = items.filter((e) => e.currency === "TZS").reduce((s, e) => s + e.amount, 0);
  const totalUsdDirect = items.filter((e) => e.currency === "USD").reduce((s, e) => s + e.amount, 0);
  return {
    customer: name,
    payer: contact?.payer ?? null,
    entries: items.map((e) => ({
      entryId: e.id,
      item: e.item ?? "goods",
      amount: e.amount,
      currency: e.currency,
      usd: e.currency === "USD" ? e.amount : Math.round((e.amount / tzsPerUsd) * 100) / 100,
      date: e.createdAt.slice(0, 10),
    })),
    totalTzs,
    totalUsd: Math.round((totalTzs / tzsPerUsd + totalUsdDirect) * 100) / 100,
  };
}

/** Outstanding balance per customer (credit sales minus payments), per currency. */
export async function balances() {
  const out: Record<string, Record<string, number>> = {};
  for (const e of await activeEntries()) {
    const sign = e.type === "credit_sale" ? 1 : e.type === "payment_received" ? -1 : 0;
    if (!sign) continue;
    out[e.counterparty] ??= {};
    out[e.counterparty][e.currency] = (out[e.counterparty][e.currency] ?? 0) + sign * e.amount;
  }
  return out;
}

export async function listContacts(): Promise<Contact[]> {
  return readJson<Contact[]>(CONTACTS_FILE, []);
}

/** Edit distance, so "Mama Hasha" (a speech-to-text slip) still matches "Mama Asha". */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Map a spoken/transcribed name to a known customer's exact spelling.
 * Exact name or alias first, then a close match (1 letter off for short names, 2 for longer).
 * Unknown names pass through unchanged — a new customer is fine.
 */
export async function canonicalCustomerName(spoken: string): Promise<string> {
  const n = spoken.trim().toLowerCase();
  const contacts = await listContacts();
  const exact = contacts.find((c) => c.name.toLowerCase() === n || c.aliases.some((a) => a.toLowerCase() === n));
  if (exact) return exact.name;
  let best: { name: string; dist: number } | null = null;
  for (const c of contacts) {
    for (const cand of [c.name, ...c.aliases]) {
      const dist = editDistance(n, cand.toLowerCase());
      const allowed = cand.length <= 5 ? 1 : 2;
      if (dist <= allowed && (!best || dist < best.dist)) best = { name: c.name, dist };
    }
  }
  return best?.name ?? spoken.trim();
}

export async function findContact(name: string): Promise<Contact | null> {
  const contacts = await readJson<Contact[]>(CONTACTS_FILE, []);
  const n = name.trim().toLowerCase();
  return (
    contacts.find(
      (c) =>
        c.name.toLowerCase() === n ||
        c.aliases.some((a) => a.toLowerCase() === n) ||
        c.name.toLowerCase().includes(n),
    ) ??
    // "Tuma bili kwa Juma": the trader may name the relative abroad instead of the customer.
    contacts.find((c) => c.payer?.name.toLowerCase() === n) ??
    // Last resort: a near-miss spelling from speech-to-text ("Mama Hasha" → Mama Asha).
    (await fuzzyContact(name, contacts))
  );
}

async function fuzzyContact(name: string, contacts: Contact[]): Promise<Contact | null> {
  const canonical = await canonicalCustomerName(name);
  return contacts.find((c) => c.name === canonical) ?? null;
}

// ---------- PayPal invoice lifecycle (driven by webhooks) ----------

export type PaymentNotice = {
  invoiceId: string;
  customer: string;
  payer?: string;
  amountTzs: number;
  at: string;
  kind?: "bill" | "topup"; // bill = a tab was paid; topup = money went into the wallet
  clearedTzs?: number; // for a top-up: how much old credit it cleared
};

const EVENTS_FILE = path.join(DATA_DIR, "events.json");

type EventLog = { processedIds: string[]; notices: PaymentNotice[] };

async function readEvents(): Promise<EventLog> {
  return readJson<EventLog>(EVENTS_FILE, { processedIds: [], notices: [] });
}

/** Webhooks are retried by PayPal (with backoff), so the same event can arrive twice. */
export async function markEventProcessed(eventId: string): Promise<boolean> {
  return locked(async () => {
    const log = await readEvents();
    if (log.processedIds.includes(eventId)) return false;
    log.processedIds.push(eventId);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(EVENTS_FILE, JSON.stringify(log, null, 2));
    return true;
  });
}

export async function latestNotices(limit = 5): Promise<PaymentNotice[]> {
  return (await readEvents()).notices.slice(-limit).reverse();
}

/** Invoice paid → mark its entries paid, add a payment_received entry, queue a notice for the UI. */
export async function settleInvoice(invoiceId: string): Promise<PaymentNotice | null> {
  return locked(async () => {
    const entries = await listEntries();
    const covered = entries.filter((e) => e.paypalInvoiceId === invoiceId && !e.paidAt);
    if (!covered.length) return null;
  
    const now = new Date().toISOString();
    covered.forEach((e) => (e.paidAt = now));
    const customer = covered[0].counterparty;
    const amountTzs = covered.filter((e) => e.currency === "TZS").reduce((s, e) => s + e.amount, 0);
    const contact = await findContact(customer);
    const payer = contact?.payer ? `${contact.payer.name} (${contact.payer.city})` : undefined;
  
    entries.push({
      id: randomUUID(),
      createdAt: now,
      type: "payment_received",
      counterparty: customer,
      amount: amountTzs,
      currency: "TZS",
      note: `Paid via PayPal${payer ? ` by ${payer}` : ""}`,
      paypalInvoiceId: invoiceId,
      paidAt: now,
    });
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));
  
    const notice: PaymentNotice = { invoiceId, customer, payer, amountTzs, at: now, kind: "bill" };
    const log = await readEvents();
    log.notices.push(notice);
    await fs.writeFile(EVENTS_FILE, JSON.stringify(log, null, 2));
    return notice;
  });
}

/** Invoice cancelled → its items go back on the unbilled tab. */
export async function unbillInvoice(invoiceId: string): Promise<number> {
  return locked(async () => {
    const entries = await listEntries();
    const covered = entries.filter((e) => e.paypalInvoiceId === invoiceId && !e.paidAt);
    covered.forEach((e) => delete e.paypalInvoiceId);
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));
    return covered.length;
  });
}

// ---------- Pochi ya familia: the prepaid family wallet ----------
// A relative abroad funds the customer's wallet through PayPal. Purchases draw it down,
// so the shop is paid up front instead of carrying credit. When it runs low, Sauti asks
// the relative for a top-up (a PayPal invoice) without being told to.

export const WALLET_LOW_TZS = Number(process.env.WALLET_LOW_TZS ?? 10000);
export const WALLET_TOPUP_TZS = Number(process.env.WALLET_TOPUP_TZS ?? 50000);
const TOPUPS_FILE = path.join(DATA_DIR, "topups.json");

export type TopupRequest = {
  invoiceId: string;
  customer: string;
  amountTzs: number;
  usd: number;
  createdAt: string;
  paidAt?: string;
  cancelledAt?: string;
};

export async function listTopups(): Promise<TopupRequest[]> {
  return readJson<TopupRequest[]>(TOPUPS_FILE, []);
}

const live = (e: LedgerEntry) => !e.voidedAt && e.currency === "TZS";

function walletOf(entries: LedgerEntry[], customer: string): number {
  let bal = 0;
  for (const e of entries) {
    if (!live(e) || e.counterparty !== customer) continue;
    if (e.type === "wallet_topup") bal += e.amount;
    if (e.type === "wallet_sale") bal -= e.amount;
  }
  return bal;
}

const owedOf = (entries: LedgerEntry[], customer: string) =>
  entries
    .filter((e) => live(e) && e.counterparty === customer && e.type === "credit_sale" && !e.paypalInvoiceId && !e.paidAt)
    .reduce((s, e) => s + e.amount, 0);

export async function walletBalances(): Promise<Record<string, number>> {
  const entries = await listEntries();
  const out: Record<string, number> = {};
  for (const name of new Set(entries.filter((e) => e.type === "wallet_topup" || e.type === "wallet_sale").map((e) => e.counterparty)))
    out[name] = walletOf(entries, name);
  return out;
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

/** How much to ask for: the standard top-up, or more if the customer already owes a lot. */
function suggestTopup(owed: number, tzsPerUsd: number) {
  const amountTzs = Math.max(WALLET_TOPUP_TZS, roundUp(owed + WALLET_LOW_TZS, 10000));
  return { amountTzs, usd: Math.round((amountTzs / tzsPerUsd) * 100) / 100 };
}

// Two sales in one sentence are recorded in parallel; only the first should trigger a top-up request.
const lastSuggested = new Map<string, number>();

/**
 * Record a sale on a customer's tab. If their wallet has money, the wallet pays (fully or partly);
 * anything it can't cover goes on credit. Returns the wallet's state so the agent can act on it.
 */
export async function recordTabSale(
  sale: { counterparty: string; item?: string; amount: number; note?: string },
  tzsPerUsd: number,
) {
  const contact = await findContact(sale.counterparty);
  const topups = await listTopups();
  return locked(async () => {
    const entries = await listEntries();
    const now = new Date().toISOString();
    const bal = walletOf(entries, sale.counterparty);
    const fromWallet = Math.min(Math.max(bal, 0), sale.amount);
    const onCredit = sale.amount - fromWallet;
    const made: LedgerEntry[] = [];
    const base = { counterparty: sale.counterparty, item: sale.item, currency: "TZS" as const, note: sale.note };
    if (fromWallet > 0) made.push({ ...base, id: randomUUID(), createdAt: now, type: "wallet_sale", amount: fromWallet, paidAt: now });
    if (onCredit > 0) made.push({ ...base, id: randomUUID(), createdAt: now, type: "credit_sale", amount: onCredit });
    entries.push(...made);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));

    const balanceAfter = walletOf(entries, sale.counterparty);
    const owed = owedOf(entries, sale.counterparty);
    const pending = topups.some((t) => t.customer === sale.counterparty && !t.paidAt && !t.cancelledAt);
    const low = !!contact?.payer && balanceAfter < WALLET_LOW_TZS;
    const recently = Date.now() - (lastSuggested.get(sale.counterparty) ?? 0) < 20000;
    const shouldRequest = low && !pending && !recently;
    if (shouldRequest) lastSuggested.set(sale.counterparty, Date.now());

    return {
      recorded: made.map((e) => ({ entryId: e.id, type: e.type, item: e.item, amount: e.amount })),
      paidFromWalletTzs: fromWallet,
      onCreditTzs: onCredit,
      wallet: { balanceTzs: balanceAfter, owedTzs: owed, low, topupAlreadyRequested: pending || (low && recently && !shouldRequest) },
      ...(shouldRequest
        ? {
            request_topup_now: {
              why: balanceAfter <= 0 ? "wallet is empty" : "wallet is running low",
              ...suggestTopup(owed, tzsPerUsd),
              payer: contact!.payer,
            },
          }
        : {}),
    };
  });
}

/** Everything about one customer's wallet, including whether they've been reliable payers. */
export async function walletStatus(customer: string, tzsPerUsd: number) {
  const contact = await findContact(customer);
  const name = contact?.name ?? customer;
  const entries = await listEntries();
  const topups = (await listTopups()).filter((t) => t.customer === name);
  const owed = owedOf(entries, name);

  // Payment record: how quickly the family has paid PayPal requests so far.
  const hours: number[] = topups.filter((t) => t.paidAt).map((t) => (Date.parse(t.paidAt!) - Date.parse(t.createdAt)) / 36e5);
  const bills = new Map<string, LedgerEntry>();
  for (const e of entries)
    if (live(e) && e.counterparty === name && e.type === "credit_sale" && e.paypalInvoiceId && e.paidAt && e.billedAt)
      bills.set(e.paypalInvoiceId, e);
  for (const e of bills.values()) hours.push((Date.parse(e.paidAt!) - Date.parse(e.billedAt!)) / 36e5);

  return {
    customer: name,
    payer: contact?.payer ?? null,
    balanceTzs: walletOf(entries, name),
    owedTzs: owed,
    lowBelowTzs: WALLET_LOW_TZS,
    pendingTopups: topups.filter((t) => !t.paidAt && !t.cancelledAt),
    suggestedTopup: suggestTopup(owed, tzsPerUsd),
    paymentRecord: {
      paypalRequestsPaid: hours.length,
      averageHoursToPay: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
      unpaidRequests: topups.filter((t) => !t.paidAt && !t.cancelledAt).length,
    },
  };
}

export async function registerTopup(customer: string, amountTzs: number, invoiceId: string, tzsPerUsd: number) {
  const name = (await findContact(customer))?.name ?? customer;
  return locked(async () => {
    const topups = await listTopups();
    if (topups.some((t) => t.invoiceId === invoiceId)) return { ok: true, alreadyLinked: true };
    lastSuggested.delete(name); // from here the pending request itself prevents duplicates
    topups.push({ invoiceId, customer: name, amountTzs, usd: Math.round((amountTzs / tzsPerUsd) * 100) / 100, createdAt: new Date().toISOString() });
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(TOPUPS_FILE, JSON.stringify(topups, null, 2));
    return { ok: true, customer: name, amountTzs, invoiceId };
  });
}

/** Top-up invoice paid → money lands in the wallet, and clears any old credit first. */
export async function settleTopup(invoiceId: string): Promise<PaymentNotice | null> {
  return locked(async () => {
    const topups = await listTopups();
    const t = topups.find((x) => x.invoiceId === invoiceId && !x.paidAt && !x.cancelledAt);
    if (!t) return null;
    const now = new Date().toISOString();
    t.paidAt = now;

    const contact = await findContact(t.customer);
    const payer = contact?.payer ? `${contact.payer.name} (${contact.payer.city})` : undefined;
    const entries = await listEntries();
    entries.push({
      id: randomUUID(), createdAt: now, type: "wallet_topup", counterparty: t.customer, amount: t.amountTzs,
      currency: "TZS", note: `Wallet topped up via PayPal${payer ? ` by ${payer}` : ""}`, paypalInvoiceId: invoiceId, paidAt: now,
    });

    // Oldest unbilled credit is cleared from the fresh balance.
    let bal = walletOf(entries, t.customer);
    let cleared = 0;
    for (const e of entries) {
      if (!live(e) || e.counterparty !== t.customer || e.type !== "credit_sale" || e.paypalInvoiceId || e.paidAt) continue;
      if (e.amount > bal) continue;
      e.type = "wallet_sale";
      e.fromCredit = true;
      e.paidAt = now;
      bal -= e.amount;
      cleared += e.amount;
    }
    await fs.writeFile(LEDGER_FILE, JSON.stringify(entries, null, 2));
    await fs.writeFile(TOPUPS_FILE, JSON.stringify(topups, null, 2));

    const notice: PaymentNotice = { invoiceId, customer: t.customer, payer, amountTzs: t.amountTzs, at: now, kind: "topup", clearedTzs: cleared };
    const log = await readEvents();
    log.notices.push(notice);
    await fs.writeFile(EVENTS_FILE, JSON.stringify(log, null, 2));
    return notice;
  });
}

export async function cancelTopup(invoiceId: string): Promise<boolean> {
  return locked(async () => {
    const topups = await listTopups();
    const t = topups.find((x) => x.invoiceId === invoiceId && !x.paidAt && !x.cancelledAt);
    if (!t) return false;
    t.cancelledAt = new Date().toISOString();
    await fs.writeFile(TOPUPS_FILE, JSON.stringify(topups, null, 2));
    return true;
  });
}

/** Every PayPal request still waiting to be paid: wallet top-ups and tab bills. */
export async function openInvoices() {
  const entries = await listEntries();
  const contacts = await listContacts();
  const payerOf = (c: string) => contacts.find((x) => x.name === c)?.payer?.name ?? null;
  const days = (iso: string) => Math.round(((Date.now() - Date.parse(iso)) / 864e5) * 10) / 10;
  const out = (await listTopups())
    .filter((t) => !t.paidAt && !t.cancelledAt)
    .map((t) => ({ invoiceId: t.invoiceId, kind: "wallet top-up", customer: t.customer, payer: payerOf(t.customer), amountTzs: t.amountTzs, daysWaiting: days(t.createdAt) }));
  const bills = new Map<string, { customer: string; amountTzs: number; at: string }>();
  for (const e of entries) {
    if (!live(e) || e.type !== "credit_sale" || !e.paypalInvoiceId || e.paidAt) continue;
    const b = bills.get(e.paypalInvoiceId) ?? { customer: e.counterparty, amountTzs: 0, at: e.billedAt ?? e.createdAt };
    b.amountTzs += e.amount;
    bills.set(e.paypalInvoiceId, b);
  }
  for (const [invoiceId, b] of bills)
    out.push({ invoiceId, kind: "tab bill", customer: b.customer, payer: payerOf(b.customer), amountTzs: b.amountTzs, daysWaiting: days(b.at) });
  return out;
}
