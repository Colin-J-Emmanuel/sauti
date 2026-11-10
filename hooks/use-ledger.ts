"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { LedgerData, Notice } from "@/lib/types";

function announce(n: Notice) {
  const who = n.payer?.split(" (")[0] ?? "Familia";
  const topup = n.kind === "topup";
  toast.success(`${who} ${topup ? "ameweka" : "amelipa"} ${n.amountTzs.toLocaleString("en-US")} TZS`, {
    description: topup
      ? `${n.payer ?? "Family abroad"} topped up ${n.customer}'s wallet with PayPal.`
      : `${n.payer ?? "Family abroad"} paid ${n.customer}'s tab with PayPal.`,
    duration: 8000,
  });
  try {
    const u = new SpeechSynthesisUtterance(
      topup
        ? `${who} ameweka shilingi ${n.amountTzs} kwenye pochi ya ${n.customer}`
        : `${who} amelipa shilingi ${n.amountTzs} kwa ${n.customer}`,
    );
    u.lang = "sw-TZ";
    speechSynthesis.speak(u);
  } catch {
    /* speech is a bonus */
  }
}

/** Polls the ledger. PayPal's webhook updates the server; this notices new payments and announces them. */
export function useLedger() {
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
      /* keep the last good view; the next poll retries */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  return { data, freshPaymentAt, refresh };
}
