"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { TalkPanel } from "@/components/talk-panel";
import { Daftari } from "@/components/daftari";
import { useLedger } from "@/hooks/use-ledger";
import type { Entry, LedgerData } from "@/lib/types";

/* ---------------- data: what the family abroad sees ---------------- */

type Invoice = { id: string; entries: Entry[]; tzs: number; usd: number; paid: boolean; lastAt: string };

function familyView(data: LedgerData | null) {
  if (!data) return null;
  const withPayer = data.customers.filter((c) => c.payer);
  if (!withPayer.length) return null;
  // Follow whichever family tab moved most recently; default to the first one.
  const lastActivity = (name: string) =>
    data.entries.filter((e) => e.counterparty === name).reduce((m, e) => (e.createdAt > m ? e.createdAt : m), "");
  const customer = [...withPayer].sort((a, b) => lastActivity(b.name).localeCompare(lastActivity(a.name)))[0];

  const credit = data.entries.filter((e) => e.counterparty === customer.name && e.type === "credit_sale");
  const byInvoice = new Map<string, Entry[]>();
  for (const e of credit) if (e.paypalInvoiceId) byInvoice.set(e.paypalInvoiceId, [...(byInvoice.get(e.paypalInvoiceId) ?? []), e]);
  const usdOf = (e: Entry) => (e.currency === "USD" ? e.amount : Math.round((e.amount / data.tzsPerUsd) * 100) / 100);
  const invoices: Invoice[] = [...byInvoice].map(([id, es]) => ({
    id,
    entries: [...es].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    tzs: es.filter((e) => e.currency === "TZS").reduce((s, e) => s + e.amount, 0),
    usd: Math.round(es.reduce((s, e) => s + usdOf(e), 0) * 100) / 100,
    paid: es.every((e) => !!e.paidAt),
    lastAt: es.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), ""),
  }));
  const latest = invoices.sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  return { customer, hasSales: credit.length > 0, latest, usdOf };
}

/* ---------------- small pieces ---------------- */

function useClock(timeZone: string) {
  const fmt = () => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date());
  const [t, setT] = useState("");
  useEffect(() => {
    setT(fmt());
    const id = setInterval(() => setT(fmt()), 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone]);
  return t;
}

function Phone({ label, children, light = false }: { label: string; children: React.ReactNode; light?: boolean }) {
  return (
    <div
      role="region"
      aria-label={label}
      className={
        "relative h-[44rem] w-full max-w-[24rem] overflow-hidden rounded-[2.6rem] border-[10px] border-[#0d1430] shadow-2xl " +
        (light ? "bg-[#f4f6fb]" : "bg-ink")
      }
    >
      <div aria-hidden className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-[#0d1430]" />
      <div className="h-full overflow-y-auto">{children}</div>
    </div>
  );
}

function City({ name, zone, who }: { name: string; zone: string; who: string }) {
  const time = useClock(zone);
  return (
    <div className="mb-4 text-center">
      <p className="text-2xl font-bold text-white">{name}</p>
      <p className="text-sm text-ink-soft">
        <span className="tabular-nums">{time || " "}</span>, {who}
      </p>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function TwoCities() {
  const { data, freshPaymentAt, refresh } = useLedger();
  const fam = familyView(data);
  const payer = fam?.customer.payer;
  const inv = fam?.latest;
  const tzs = (n: number) => `${Math.round(n).toLocaleString("en-US")} TZS`;

  const steps = [
    {
      done: !!fam?.hasSales,
      sw: `${fam?.customer.name ?? "Mteja"} anachukua bidhaa kwa mkopo`,
      en: "She takes groceries on credit. The shopkeeper says it; Sauti writes it in the daftari.",
    },
    {
      done: !!inv,
      sw: `Bili inaenda ${payer?.city ?? "nje ya nchi"}`,
      en: inv
        ? `Sauti sends ${payer?.name} a PayPal invoice: ${tzs(inv.tzs)} becomes $${inv.usd.toFixed(2)}.`
        : `Sauti sends ${payer?.name ?? "the family"} a PayPal invoice in dollars.`,
      arrow: "→",
    },
    {
      done: !!inv?.paid,
      sw: `${payer?.name ?? "Familia"} analipa kwa PayPal`,
      en: "He pays in one tap and sees exactly what it bought.",
      arrow: "←",
    },
    {
      done: !!inv?.paid,
      sw: "Deni limefutwa",
      en: "PayPal tells Sauti. The tab is stamped paid; the shop withdraws to M-Pesa.",
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <main className="min-h-dvh bg-ink px-5 py-6 text-white sm:px-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href="/" className="text-3xl font-extrabold tracking-tight">
          Sauti
        </Link>
        <p className="text-sm text-ink-soft">One tab, two cities: the shop in Dar es Salaam, the family abroad</p>
      </header>

      <div className="mx-auto mt-6 grid max-w-[78rem] items-start justify-items-center gap-8 lg:grid-cols-[1fr_17rem_1fr]">
        {/* Dar es Salaam: the real app */}
        <div className="w-full max-w-[24rem]">
          <City name="Dar es Salaam" zone="Africa/Dar_es_Salaam" who="Mzee Salim's shop" />
          <Phone label="The shopkeeper's phone in Dar es Salaam">
            <div className="px-4 pb-5 pt-9">
              <TalkPanel onDone={refresh} compact />
            </div>
            <div className="min-h-[24rem] bg-paper">
              <Daftari data={data} freshPaymentAt={freshPaymentAt} compact />
            </div>
          </Phone>
        </div>

        {/* The journey: a real sequence, lit as each step happens */}
        <ol className="w-full max-w-[24rem] space-y-5 lg:mt-40" aria-label="How the money moves">
          {steps.map((s, i) => (
            <li key={i} className={"flex gap-3 transition-opacity duration-500 " + (s.done || i === current ? "opacity-100" : "opacity-45")}>
              <span
                className={
                  "grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors duration-500 " +
                  (s.done ? "bg-paid text-white" : i === current ? "bg-marigold text-ink" : "bg-ink-2 text-ink-soft")
                }
              >
                {s.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span>
                <span className="block font-semibold leading-snug">
                  {s.sw} {s.arrow && <span className="text-marigold">{s.arrow}</span>}
                </span>
                <span className="block text-sm leading-snug text-ink-soft">{s.en}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* The family's city: what Juma sees */}
        <div className="w-full max-w-[24rem]">
          <City
            name={payer?.city ?? "New York"}
            zone={payer?.city === "Houston" ? "America/Chicago" : "America/New_York"}
            who={payer ? `her ${payer.relation} ${payer.name}` : "the family"}
          />
          <Phone label={`${payer?.name ?? "The family"}'s phone`} light>
            <div className="flex min-h-full flex-col px-5 pb-5 pt-10 text-foreground">
              {!inv ? (
                <div className="my-auto text-center">
                  <p className="text-lg font-semibold">No bills yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    When the shop sends {payer?.name ?? "the family"} a bill for {fam?.customer.name ?? "a customer"}'s groceries, it
                    shows up here.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Invoice from</p>
                  <p className="text-lg font-bold">Duka la Mzee Salim</p>
                  <p className="text-xs text-muted-foreground">Dar es Salaam</p>

                  <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">Groceries for {fam!.customer.name}</p>
                    <ul className="mt-3 space-y-2.5 text-sm">
                      {inv.entries.map((e) => (
                        <li key={e.id} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate">{e.item ?? "Groceries"}</span>
                            <span className="block text-xs text-muted-foreground">{tzs(e.amount)}</span>
                          </span>
                          <span className="font-semibold tabular-nums">${fam!.usdOf(e).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex justify-between border-t pt-3 font-bold">
                      <span>Total</span>
                      <span className="tabular-nums">${inv.usd.toFixed(2)}</span>
                    </div>
                  </div>

                  {inv.paid ? (
                    <div className="mt-4 rounded-xl bg-[#e8f5ec] p-4 text-paid animate-in fade-in duration-500">
                      <p className="flex items-center gap-2 font-bold">
                        <Check className="size-5" strokeWidth={3} /> Paid with PayPal
                      </p>
                      <p className="mt-1 text-sm text-[#2a5a3c]">
                        ${inv.usd.toFixed(2)} went straight to the shop. {fam!.customer.name}'s tab is clear.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <a
                        href={`https://www.sandbox.paypal.com/invoice/p/#${inv.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#ffc439] font-semibold text-[#111c4e] hover:brightness-95"
                      >
                        Pay ${inv.usd.toFixed(2)} in PayPal <ExternalLink className="size-4" />
                      </a>
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        PayPal also emailed this invoice to {payer?.name}. Opens the sandbox; log in as {payer?.name}.
                      </p>
                    </div>
                  )}
                  <p className="mt-auto pt-6 text-center text-xs text-muted-foreground">Invoice {inv.id}</p>
                </>
              )}
            </div>
          </Phone>
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-[78rem] text-xs text-ink-soft/80">
        Demo view on PayPal's sandbox. The left phone is the live app; the right phone shows what the family receives, updated
        when PayPal confirms the payment.
      </p>
    </main>
  );
}
