"use client";

import { Check, Send, Wallet } from "lucide-react";
import type { Customer, Entry, LedgerData, Notice, Topup } from "@/lib/types";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const payerFromNote = (note?: string) => note?.match(/by (.+?) \(/)?.[1];

type Tab = {
  name: string;
  entries: Entry[]; // oldest first, like a written book
  owed: number; // TZS still on credit
  wallet: number | null; // TZS in the family wallet; null = no wallet activity yet
  lastAt: string;
  customer?: Customer;
  billsWaiting: { invoiceId: string; tzs: number }[]; // tab bills sent to PayPal, not paid yet
  topupWaiting?: Topup; // a top-up Sauti asked for, not paid yet
  notice?: Notice; // latest PayPal payment for this customer
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
    const waiting = new Map<string, number>();
    for (const e of entries)
      if (e.type === "credit_sale" && e.paypalInvoiceId && !e.paidAt && e.currency === "TZS")
        waiting.set(e.paypalInvoiceId, (waiting.get(e.paypalInvoiceId) ?? 0) + e.amount);
    tabs.push({
      name,
      entries,
      owed: data.balances[name]?.TZS ?? 0,
      wallet: name in data.wallets ? data.wallets[name] : null,
      lastAt: entries.at(-1)?.createdAt ?? "",
      customer: data.customers.find((c) => c.name === name),
      billsWaiting: [...waiting].map(([invoiceId, tzs]) => ({ invoiceId, tzs })),
      topupWaiting: data.topups.find((t) => t.customer === name && !t.paidAt),
      notice: data.notices.find((n) => n.customer === name),
    });
  }
  return tabs.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function Row({ entry }: { entry: Entry }) {
  const moneyIn = entry.type === "wallet_topup" || entry.type === "payment_received";
  const who = payerFromNote(entry.note);
  // Narrow pages get the short form so nothing is cut off.
  const short = moneyIn ? `${who ?? "Familia"}, PayPal` : null;
  const label =
    entry.type === "wallet_topup"
      ? `${who ?? "Familia"} ameweka pesa, PayPal`
      : entry.type === "payment_received"
        ? `${who ?? "Familia"} amelipa, PayPal`
        : entry.type === "cash_sale"
          ? `${entry.item ?? "Mauzo"} (taslimu)`
          : entry.type === "expense"
            ? `${entry.item ?? "Matumizi"} (gharama)`
            : (entry.item ?? "Bidhaa");
  const amount = (entry.type === "wallet_topup" ? "+" : entry.type === "payment_received" ? "−" : "") + num(entry.amount);
  const ink = moneyIn ? "text-paid" : "text-pen";
  return (
    <li className="daftari-row">
      <span className="pl-3 font-hand text-sm text-margin">{day(entry.createdAt)}</span>
      <span title={label} className={"truncate pl-4 font-hand text-[1.2rem] leading-tight " + ink}>
        {short ? (
          <>
            <span className="@2xl:hidden">{short}</span>
            <span className="hidden @2xl:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span className={"font-hand text-[1.2rem] leading-none tabular-nums " + ink}>
        {amount}
        {entry.currency !== "TZS" && ` ${entry.currency}`}
      </span>
      <span className="grid place-items-center">
        {entry.type === "wallet_sale" ? (
          <Wallet aria-label="Paid from the family wallet" className="size-3.5 text-paid" />
        ) : entry.type === "credit_sale" && entry.paidAt ? (
          <Check aria-label="Paid via PayPal" className="size-4 text-paid" strokeWidth={3} />
        ) : entry.type === "credit_sale" && entry.paypalInvoiceId ? (
          <Send aria-label="On a PayPal invoice, waiting for payment" className="size-3.5 text-pen" />
        ) : null}
      </span>
    </li>
  );
}

function InfoLine({ short, long }: { short: string; long: string }) {
  return (
    <p className="daftari-row text-sm text-pen">
      <span />
      <span className="col-span-3 truncate pl-4 pr-3">
        <span className="@2xl:hidden">{short}</span>
        <span className="hidden @2xl:inline">{long}</span>
      </span>
    </p>
  );
}

function TabSection({ tab, tzsPerUsd, lowAt, freshPaymentAt }: { tab: Tab; tzsPerUsd: number; lowAt: number; freshPaymentAt?: string }) {
  const payer = tab.customer?.payer;
  const hasWallet = tab.wallet !== null;
  const funded = `${payer?.relation} ${payer?.name} in ${payer?.city}`;
  // Stamp the latest PayPal payment, until something is owed or requested again.
  const stamped =
    !!tab.notice && !tab.topupWaiting && tab.owed <= 0 && (tab.notice.kind === "topup" ? (tab.wallet ?? 0) > 0 : true);
  const isTopup = tab.notice?.kind === "topup";

  return (
    <section aria-label={`${tab.name}'s tab`} className="relative">
      <header className="daftari-row">
        <span />
        <h3 className="truncate pl-4 font-hand text-[1.6rem] font-bold leading-tight text-ink">{tab.name}</h3>
        <span className="col-span-2 hidden pr-3 text-right text-xs leading-tight text-muted-foreground @2xl:block">
          {payer ? (
            <>
              Family wallet, funded by
              <br />
              {funded} with PayPal
            </>
          ) : (
            "Pays at the shop"
          )}
        </span>
      </header>
      <p className="daftari-row text-xs text-muted-foreground @2xl:hidden">
        <span />
        <span className="col-span-3 truncate pl-4 pr-3">{payer ? `Wallet funded by ${funded}` : "Pays at the shop"}</span>
      </p>

      <ul>
        {tab.entries.map((e) => (
          <Row key={e.id} entry={e} />
        ))}
      </ul>

      {tab.topupWaiting && (
        <InfoLine
          short={`Asked ${payer?.name ?? "family"} for $${tab.topupWaiting.usd.toFixed(2)}, awaiting PayPal`}
          long={`Sauti asked ${payer?.name ?? "the family"} to add ${num(tab.topupWaiting.amountTzs)} TZS ($${tab.topupWaiting.usd.toFixed(2)}) by PayPal. Waiting for payment.`}
        />
      )}
      {tab.billsWaiting.map((w) => (
        <InfoLine
          key={w.invoiceId}
          short={`Invoice $${(w.tzs / tzsPerUsd).toFixed(2)} sent, awaiting payment`}
          long={`PayPal invoice for $${(w.tzs / tzsPerUsd).toFixed(2)} sent to ${payer?.name ?? "the family"}. Waiting for payment.`}
        />
      ))}

      {(tab.owed > 0 || !hasWallet) && (
        <div className="daftari-row">
          <span />
          <span className="pl-4 font-hand text-[1.2rem] leading-none text-ink">Anadaiwa</span>
          <span className="border-b-[3px] border-double border-ink pb-0.5 font-hand text-[1.3rem] font-bold leading-none tabular-nums text-ink">
            {num(Math.max(tab.owed, 0))} TZS
          </span>
          <span />
        </div>
      )}
      {hasWallet && (
        <div className="daftari-row">
          <span />
          <span className="pl-4 font-hand text-[1.2rem] leading-none text-paid">
            Salio la pochi
            {(tab.wallet ?? 0) < lowAt && <span className="ml-2 font-sans text-xs text-margin">chini / low</span>}
          </span>
          <span className="border-b-[3px] border-double border-paid pb-0.5 font-hand text-[1.3rem] font-bold leading-none tabular-nums text-paid">
            {num(tab.wallet ?? 0)} TZS
          </span>
          <span />
        </div>
      )}
      {/* Blank ruled space under each tab; in narrow layouts the stamp lands here so it never covers writing. */}
      <div aria-hidden className={stamped ? "h-[calc(var(--line)*2)] @2xl:h-[var(--line)]" : "h-[var(--line)]"} />

      {stamped && (
        <div
          key={tab.notice!.at}
          className={
            "stamp pointer-events-none absolute bottom-5 right-5 origin-bottom-right scale-[0.85] text-center @2xl:bottom-[3.1rem] @2xl:right-[11rem] @2xl:scale-100 " +
            (freshPaymentAt === tab.notice!.at ? "stamp-land" : "")
          }
          role="img"
          aria-label={
            isTopup
              ? `Wallet topped up with PayPal by ${tab.notice!.payer ?? "family"}`
              : `Paid in full with PayPal by ${tab.notice!.payer ?? "family"}`
          }
        >
          <span className="block text-xl font-extrabold tracking-wide">{isTopup ? "POCHI IMEJAZWA" : "IMELIPWA"}</span>
          <span className="block text-[0.7rem] font-semibold">{isTopup ? "TOPPED UP WITH PAYPAL" : "PAID WITH PAYPAL"}</span>
        </div>
      )}
    </section>
  );
}

export function Daftari({ data, freshPaymentAt, compact = false }: { data: LedgerData | null; freshPaymentAt?: string; compact?: boolean }) {
  const tabs = data ? buildTabs(data) : [];
  const totalOwed = tabs.reduce((s, t) => s + Math.max(t.owed, 0), 0);
  const totalWallets = tabs.reduce((s, t) => s + Math.max(t.wallet ?? 0, 0), 0);

  return (
    <div className="@container flex h-full flex-col">
      {compact ? (
        <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3">
          <h2 className="text-lg font-bold text-ink">Daftari</h2>
          <p className="text-sm text-muted-foreground">
            Owed <span className="font-bold tabular-nums text-ink">{num(totalOwed)}</span>
            <span className="ml-3">
              Pochi <span className="font-bold tabular-nums text-paid">{num(totalWallets)}</span>
            </span>
          </p>
        </div>
      ) : (
        <div className="flex max-w-[54rem] flex-wrap items-end justify-between gap-x-4 gap-y-3 px-6 pb-4 pt-6 @2xl:px-8">
          <div>
            <h2 className="text-2xl font-bold text-ink">Daftari</h2>
            <p className="text-sm text-muted-foreground">The shop's book, written as you speak</p>
          </div>
          <dl className="flex shrink-0 gap-6 text-sm text-muted-foreground @2xl:text-right">
            <div>
              <dt>Customers owe</dt>
              <dd className="whitespace-nowrap text-lg font-bold tabular-nums text-ink @2xl:text-2xl">{num(totalOwed)} TZS</dd>
            </div>
            <div>
              <dt>In family wallets</dt>
              <dd className="whitespace-nowrap text-lg font-bold tabular-nums text-paid @2xl:text-2xl">{num(totalWallets)} TZS</dd>
            </div>
          </dl>
        </div>
      )}

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
              <span className="col-span-3 pl-4 pr-3 text-sm text-muted-foreground">
                The book is empty. Speak a sale, or tap an example, and Sauti writes it here.
              </span>
            </p>
          </div>
        ) : (
          <div className="max-w-[54rem]">
            {tabs.map((t) => (
              <TabSection key={t.name} tab={t} tzsPerUsd={data.tzsPerUsd} lowAt={data.walletLowTzs} freshPaymentAt={freshPaymentAt} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
