import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type EntryType =
  | "credit_sale" // customer took goods, owes the trader
  | "payment_received" // customer paid (cash or PayPal)
  | "cash_sale" // paid on the spot
  | "expense"; // trader paid a supplier / bought stock

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
  paidAt?: string; // set when the PayPal invoice covering this entry is paid
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
    updated.forEach((e) => (e.paypalInvoiceId = invoiceId));
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
    null
  );
}

// ---------- PayPal invoice lifecycle (driven by webhooks) ----------

export type PaymentNotice = {
  invoiceId: string;
  customer: string;
  payer?: string;
  amountTzs: number;
  at: string;
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
  
    const notice: PaymentNotice = { invoiceId, customer, payer, amountTzs, at: now };
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
