"use client";

import Link from "next/link";
import { TalkPanel } from "@/components/talk-panel";
import { Daftari } from "@/components/daftari";
import { useLedger } from "@/hooks/use-ledger";

export default function Home() {
  const { data, freshPaymentAt, refresh } = useLedger();

  return (
    <main className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[minmax(22rem,30rem)_1fr]">
      <div className="bg-ink px-5 pb-10 pt-6 sm:px-8 lg:overflow-y-auto">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Sauti</h1>
          <p className="text-right text-sm leading-tight text-ink-soft">
            Duka la Mzee Salim
            <br />
            Dar es Salaam
          </p>
        </header>
        <TalkPanel onDone={() => refresh()} />
        <p className="mt-10 text-xs leading-relaxed text-ink-soft/80">
          Demo running on PayPal's sandbox: invoices and payments are test money. Amounts are kept in shillings and
          invoiced in US dollars at {data?.tzsPerUsd ?? 2500} TZS to $1.{" "}
          <Link href="/demo" className="text-white underline underline-offset-4">
            See both sides: the shop and the family abroad
          </Link>
        </p>
      </div>
      <div className="bg-paper lg:overflow-hidden lg:rounded-l-2xl">
        <Daftari data={data} freshPaymentAt={freshPaymentAt} />
      </div>
    </main>
  );
}
