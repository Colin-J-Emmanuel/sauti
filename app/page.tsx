"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TalkPanel } from "@/components/talk-panel";
import { Daftari } from "@/components/daftari";
import type { LedgerData, Notice } from "@/lib/types";

function announce(n: Notice) {
  const who = n.payer?.split(" (")[0] ?? "Familia";
  toast.success(`${who} amelipa ${n.amountTzs.toLocaleString("en-US")} TZS`, {
    description: `${n.payer ?? "Family abroad"} paid ${n.customer}'s tab with PayPal.`,
    duration: 8000,
  });
  try {
    const u = new SpeechSynthesisUtterance(`${who} amelipa shilingi ${n.amountTzs} kwa ${n.customer}`);
    u.lang = "sw-TZ";
    speechSynthesis.speak(u);
  } catch {
    /* speech is a bonus */
  }
}

export default function Home() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [freshPaymentAt, setFreshPaymentAt] = useState<string>();
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/ledger", { cache: "no-store" })).json()) as LedgerData;
      setData(d);
      const latest = d.notices?.[0];
      // Only announce payments that arrive while the page is open.
      if (latest && seen.current !== null && latest.at !== seen.current) {
        setFreshPaymentAt(latest.at);
        announce(latest);
      }
      seen.current = latest?.at ?? "";
    } catch {
      /* keep the last good view; next poll will retry */
    }
  }, []);

  useEffect(() => {
    refresh();
    // PayPal's webhook updates the server; the page checks every few seconds.
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

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
        <TalkPanel onDone={refresh} />
        <p className="mt-10 text-xs leading-relaxed text-ink-soft/80">
          Demo running on PayPal's sandbox: invoices and payments are test money. Amounts are kept in shillings and
          invoiced in US dollars at {data?.tzsPerUsd ?? 2500} TZS to $1.
        </p>
      </div>
      <div className="bg-paper lg:overflow-hidden lg:rounded-l-2xl">
        <Daftari data={data} freshPaymentAt={freshPaymentAt} />
      </div>
    </main>
  );
}
