"use client";

import { Check, Send } from "lucide-react";
import type { Customer, Entry, LedgerData, Notice } from "@/lib/types";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

type Tab = {
  name: string;
  entries: Entry[]; // oldest first, like a written book
  owed: number; // TZS
  lastAt: string;
  customer?: Customer;
  waiting: { invoiceId: string; tzs: number }[]; // sent to PayPal, not paid yet
  paidNotice?: Notice;
};

function buildTabs(data: LedgerData): Tab[] {
  const byName = new Map<string, Entry[]>();
  for (const e of data.entries) {
    if (!byName.has(e.counterparty)) byName.set(e.counterparty, []);
    byName.get(e.counterparty)!.push(e);
  }
  const tabs: Tab[] = [];
  for (const [name, list] of byName) {
    const entries = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const owed = data.balances[name]?.TZS ?? 0;
    const waitingMap = new Map<string, number>();
    for (const e of entries) {
      if (e.type === "credit_sale" && e.paypalInvoiceId && !e.paidAt && e.currency === "TZS")
        waitingMap.set(e.paypalInvoiceId, (waitingMap.get(e.paypalInvoiceId) ?? 0) + e.amount);
    }
    tabs.push({
      name,
      entries,
      owed,
      lastAt: entries.at(-1)?.createdAt ?? "",
      customer: data.customers.find((c) => c.name === name),
      waiting: [...waitingMap].map(([invoiceId, tzs]) => ({ invoiceId, tzs })),
      paidNotice: data.notices.find((n) => n.customer === name),
    });
  }
  return tabs.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function Row({ entry }: { entry: Entry }) {
  const isPayment = entry.type === "payment_received";
  const label = isPayment
    ? `Malipo ya PayPal${entry.note?.match(/by (.+?) \(/) ? `, ${entry.note.match(/by (.+?) \(/)![1]}` : ""}`
    : entry.type === "cash_sale"
      ? `${entry.item ?? "Mauzo"} (taslimu)`
      : entry.type === "expense"
        ? `${entry.item ?? "Matumizi"} (gharama)`
        : (entry.item ?? "Bidhaa");
  const sign = isPayment ? "−" : "";
  return (
    <li className="daftari-row">
      <span className="pl-3 font-hand text-sm text-margin">{day(entry.createdAt)}</span>
      <span title={label} className={"truncate pl-4 font-hand text-[1.2rem] leading-tight " + (isPayment ? "text-paid" : "text-pen")}>{label}</span>
      <span className={"font-hand text-[1.2rem] leading-none tabular-nums " + (isPayment ? "text-paid" : "text-pen")}>
        {sign}
        {num(entry.amount)}
        {entry.currency !== "TZS" && ` ${entry.currency}`}
      </span>
      <span className="grid place-items-center">
        {entry.type === "credit_sale" && entry.paidAt ? (
          <Check aria-label="Paid via PayPal" className="size-4 text-paid" strokeWidth={3} />
        ) : entry.type === "credit_sale" && entry.paypalInvoiceId ? (
          <Send aria-label="On a PayPal invoice, waiting for payment" className="size-3.5 text-pen" />
        ) : null}
      </span>
    </li>
  );
}

function TabSection({ tab, tzsPerUsd, freshPaymentAt }: { tab: Tab; tzsPerUsd: number; freshPaymentAt?: string }) {
  const payer = tab.customer?.payer;
  const settled = tab.owed <= 0 && !!tab.paidNotice;
  return (
    <section aria-label={`${tab.name}'s tab`} className="relative">
      <header className="daftari-row" style={{ alignItems: "end" }}>
        <span />
        <h3 className="truncate pl-4 font-hand text-[1.6rem] font-bold leading-tight text-ink">{tab.name}</h3>
        <span className="col-span-2 hidden pr-3 text-right text-xs leading-tight text-muted-foreground sm:block">
          {payer ? (
            <>
              Paid by {payer.relation} {payer.name}
              <br />
              in {payer.city}, via PayPal
            </>
          ) : (
            "Pays at the shop"
          )}
        </span>
      </header>
      <p className="daftari-row text-xs text-muted-foreground sm:hidden">
        <span />
        <span className="col-span-3 truncate pl-4 pr-3">
          {payer ? `Paid by ${payer.relation} ${payer.name} in ${payer.city}, via PayPal` : "Pays at the shop"}
        </span>
      </p>

      <ul>
        {tab.entries.map((e) => (
          <Row key={e.id} entry={e} />
        ))}
      </ul>

      {tab.waiting.map((w) => (
        <p key={w.invoiceId} className="daftari-row text-sm text-pen">
          <span />
          <span className="col-span-3 truncate pl-4">
            <span className="sm:hidden">Invoice ${(w.tzs / tzsPerUsd).toFixed(2)} sent, awaiting payment</span>
            <span className="hidden sm:inline">
              PayPal invoice for ${(w.tzs / tzsPerUsd).toFixed(2)} sent to {payer?.name ?? "the family"}. Waiting for payment.
            </span>
          </span>
        </p>
      ))}

      <div className="daftari-row">
        <span />
        <span className="pl-4 font-hand text-[1.2rem] leading-none text-ink">Anadaiwa</span>
        <span className="border-b-[3px] border-double border-ink pb-0.5 font-hand text-[1.3rem] font-bold leading-none tabular-nums text-ink">
          {num(Math.max(tab.owed, 0))} TZS
        </span>
        <span />
      </div>
      <div className="daftari-row" aria-hidden>
        <span />
      </div>

      {settled && (
        <div
          key={tab.paidNotice!.at}
          className={"stamp pointer-events-none absolute right-4 top-1 origin-top-right scale-[0.8] text-center sm:bottom-[3.1rem] sm:right-[11rem] sm:top-auto sm:origin-bottom-right sm:scale-100 " + (freshPaymentAt === tab.paidNotice!.at ? "stamp-land" : "")}
          role="img"
          aria-label={`Paid in full via PayPal by ${tab.paidNotice!.payer ?? "family"}`}
        >
          <span className="block text-xl font-extrabold tracking-wide">IMELIPWA</span>
          <span className="block text-[0.7rem] font-semibold">PAID WITH PAYPAL</span>
        </div>
      )}
    </section>
  );
}

export function Daftari({ data, freshPaymentAt }: { data: LedgerData | null; freshPaymentAt?: string }) {
  const tabs = data ? buildTabs(data) : [];
  const totalOwed = tabs.reduce((s, t) => s + Math.max(t.owed, 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex max-w-[54rem] items-end justify-between gap-4 px-6 pb-4 pt-6 sm:px-8">
        <div>
          <h2 className="text-2xl font-bold text-ink">Daftari</h2>
          <p className="text-sm text-muted-foreground">The shop's credit book, written as you speak</p>
        </div>
        <p className="shrink-0 text-right text-sm text-muted-foreground">
          Customers owe
          <span className="block whitespace-nowrap text-2xl font-bold tabular-nums text-ink">{num(totalOwed)} TZS</span>
        </p>
      </div>

      <div className="daftari min-h-[28rem] flex-1 overflow-y-auto rounded-t-lg border-t border-rule pt-[2.25rem] shadow-[0_-1px_0_0_var(--rule)]">
        {!data ? (
          <p className="daftari-row">
            <span />
            <span className="pl-4 font-hand text-lg text-muted-foreground">Inafungua daftari…</span>
          </p>
        ) : tabs.length === 0 ? (
          <div>
            <p className="daftari-row">
              <span />
              <span className="col-span-3 pl-4 font-hand text-[1.35rem] leading-none text-pen">Daftari bado ni tupu.</span>
            </p>
            <p className="daftari-row">
              <span />
              <span className="col-span-3 pl-4 text-sm text-muted-foreground">
                The book is empty. Speak a sale, or tap an example, and Sauti writes it here.
              </span>
            </p>
          </div>
        ) : (
          <div className="max-w-[54rem]">
            {tabs.map((t) => (
              <TabSection key={t.name} tab={t} tzsPerUsd={data.tzsPerUsd} freshPaymentAt={freshPaymentAt} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
