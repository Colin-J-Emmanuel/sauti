"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, MessageCircle, RotateCcw } from "lucide-react";
import { TalkPanel } from "@/components/talk-panel";
import { Daftari } from "@/components/daftari";
import { AgentSteps } from "@/components/agent-steps";
import { WhatsAppThread, type Lang } from "@/components/whatsapp-thread";
import { useLedger } from "@/hooks/use-ledger";
import type { Entry, LedgerData } from "@/lib/types";

const tzs = (n: number) => `${Math.round(n).toLocaleString("en-US")} TZS`;

/* ---------------- data: what the family abroad sees ---------------- */

function familyView(data: LedgerData | null) {
  if (!data) return null;
  const withPayer = data.customers.filter((c) => c.payer);
  if (!withPayer.length) return null;
  // Follow whichever family tab moved most recently; default to the first one.
  const lastActivity = (name: string) =>
    data.entries.filter((e) => e.counterparty === name).reduce((m, e) => (e.createdAt > m ? e.createdAt : m), "");
  const customer = [...withPayer].sort((a, b) => lastActivity(b.name).localeCompare(lastActivity(a.name)))[0];
  const mine = data.entries.filter((e) => e.counterparty === customer.name);
  const usd = (t: number) => Math.round((t / data.tzsPerUsd) * 100) / 100;

  const purchases = mine.filter((e) => e.type === "wallet_sale" || e.type === "credit_sale"); // newest first
  const topups = data.topups.filter((t) => t.customer === customer.name);
  const request = topups.find((t) => !t.paidAt);

  // A bill for an exact tab (the older flow), if one is waiting.
  const billEntries = mine.filter((e) => e.type === "credit_sale" && e.paypalInvoiceId && !e.paidAt);
  const bill = billEntries.length
    ? { id: billEntries[0].paypalInvoiceId!, tzs: billEntries.reduce((s, e) => s + e.amount, 0), entries: billEntries }
    : null;

  const notice = data.notices.find((n) => n.customer === customer.name);
  const owed = Math.max(data.balances[customer.name]?.TZS ?? 0, 0);
  return {
    customer,
    usd,
    balance: data.wallets[customer.name] ?? 0,
    hasWallet: customer.name in data.wallets,
    owed,
    purchases,
    request,
    bill,
    notice,
    anySale: purchases.length > 0,
    anyRequest: topups.length > 0 || mine.some((e) => e.paypalInvoiceId),
    anyPaid: topups.some((t) => t.paidAt) || mine.some((e) => e.type === "payment_received"),
    walletPaidSomething: mine.some((e) => e.type === "wallet_sale" && !e.fromCredit),
  };
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

/** English for judges by default; Kiswahili shows the shopkeeper's side as he sees it. ?lang=sw works too. */
function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("lang");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("sauti-demo-lang");
    } catch {}
    const l = q === "sw" || q === "en" ? q : saved === "sw" ? "sw" : "en";
    setLangState(l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "sw" ? "sw" : "en";
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("sauti-demo-lang", l);
    } catch {}
    const url = new URL(window.location.href);
    if (l === "sw") url.searchParams.set("lang", "sw");
    else url.searchParams.delete("lang");
    window.history.replaceState(null, "", url);
  };
  return [lang, setLang];
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div role="radiogroup" aria-label="Language" className="inline-flex rounded-full bg-ink-2/70 p-1 text-sm">
      {(
        [
          ["en", "English"],
          ["sw", "Kiswahili"],
        ] as const
      ).map(([l, label]) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          lang={l}
          onClick={() => setLang(l)}
          className={
            "rounded-full px-3.5 py-1 font-semibold transition-colors " + (lang === l ? "bg-white text-ink" : "text-ink-soft hover:text-white")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Clears the demo so the next person can run the whole loop from an empty daftari. Two clicks, no dialog. */
function StartOver({ sw, onReset }: { sw: boolean; onReset: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "confirm" | "working">("idle");
  useEffect(() => {
    if (state !== "confirm") return;
    const t = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      onClick={async () => {
        if (state === "idle") return setState("confirm");
        if (state !== "confirm") return;
        setState("working");
        try {
          await onReset();
        } finally {
          setState("idle");
        }
      }}
      disabled={state === "working"}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60 " +
        (state === "confirm" ? "bg-marigold text-ink" : "bg-ink-2/70 text-ink-soft hover:text-white")
      }
    >
      <RotateCcw aria-hidden className="size-3.5" />
      {state === "confirm"
        ? sw ? "Futa yote? Bonyeza tena" : "Clear everything? Click again"
        : state === "working"
          ? sw ? "Inafuta…" : "Clearing…"
          : sw ? "Anza upya" : "Start over"}
    </button>
  );
}

const RELATION_SW: Record<string, string> = { son: "mwanawe", daughter: "binti yake", granddaughter: "mjukuu wake", grandson: "mjukuu wake" };

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

function PayButton({ invoiceId, usd, name }: { invoiceId: string; usd: number; name?: string }) {
  return (
    <>
      <a
        href={`https://www.sandbox.paypal.com/invoice/p/#${invoiceId}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex h-11 items-center justify-center gap-2 rounded-full bg-[#ffc439] font-semibold text-[#111c4e] hover:brightness-95"
      >
        Pay ${usd.toFixed(2)} in PayPal <ExternalLink className="size-4" />
      </a>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        PayPal emailed this to {name ?? "the family"} too. Opens the sandbox; log in as {name ?? "the payer"}.
      </p>
    </>
  );
}

function purchaseTag(e: Entry) {
  if (e.type === "wallet_sale") return { text: "paid from wallet", cls: "text-paid" };
  if (e.paidAt) return { text: "paid", cls: "text-paid" };
  if (e.paypalInvoiceId) return { text: "billed", cls: "text-muted-foreground" };
  return { text: "on credit", cls: "text-margin" };
}

/* ---------------- page ---------------- */

export default function TwoCities() {
  const { data, freshPaymentAt, refresh } = useLedger();
  const [lang, setLang] = useLang();
  const [resetKey, setResetKey] = useState(0);
  const sw = lang === "sw";
  const [localAt, setLocalAt] = useState<string>("");
  const [tab, setTab] = useState<"app" | "whatsapp">("app");
  const chat = data?.whatsapp ?? [];
  // When a new WhatsApp message comes in from the shopkeeper's phone, show it.
  const seenChat = useRef<number | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!data) return;
    const n = chat.length;
    if (seenChat.current === null) {
      seenChat.current = n;
      return;
    }
    if (n < seenChat.current) seenChat.current = n; // the demo was started over
    if (n > seenChat.current) {
      const fromShop = chat.slice(seenChat.current).some((m) => m.from === "shop");
      if (fromShop) setTab("whatsapp");
      else if (tab !== "whatsapp") setUnread((u) => u + (n - seenChat.current!));
    }
    seenChat.current = n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, chat.length]);
  useEffect(() => {
    if (tab === "whatsapp") setUnread(0);
  }, [tab]);
  const activity = data?.activity ?? null;
  const fam = familyView(data);
  const payer = fam?.customer.payer;
  const who = payer?.name ?? "Familia";
  const she = fam?.customer.name ?? "Mteja";

  const payerName = payer?.name ?? (sw ? "familia" : "the family");
  const steps = [
    {
      done: !!fam?.anySale,
      title: sw ? `${she} ananunua dukani` : `${she} shops`,
      body: sw
        ? "Anachukua bidhaa. Muuza duka anasema, na Sauti anaandika kwenye daftari."
        : "The shopkeeper says it out loud, and Sauti writes it in the daftari.",
    },
    {
      done: !!fam?.anyRequest,
      title: sw ? `Sauti anamwomba ${who} ajaze pochi` : `Sauti asks ${who} to top up`,
      body: sw
        ? `Bila kuambiwa, Sauti anamtumia ${payerName} ombi la PayPal la kujaza pochi yake ya manunuzi.`
        : `On its own, Sauti sends ${payerName} a PayPal request to fund her grocery wallet.`,
      arrow: "→",
    },
    {
      done: !!fam?.anyPaid,
      title: sw ? `${who} analipa kwa PayPal` : `${who} pays with PayPal`,
      body: sw
        ? "Analipa kwa mguso mmoja. Deni lake linafutwa, na kinachobaki kinakaa kwenye pochi."
        : "One tap. What she owed is cleared, and the rest waits in her wallet.",
      arrow: "←",
    },
    {
      done: !!fam?.walletPaidSomething,
      title: sw ? "Pochi inalipa manunuzi" : "The wallet pays for her groceries",
      body: sw
        ? "Manunuzi yajayo yanalipwa papo hapo. Pochi ikipungua, Sauti anaomba tena."
        : "Her next purchases are paid on the spot. When the wallet runs low, Sauti asks again.",
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <main className="min-h-dvh bg-ink px-5 py-6 text-white sm:px-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href="/" className="text-3xl font-extrabold tracking-tight">
          Sauti
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-sm text-ink-soft">
            {sw
              ? "Wakala wa PayPal anayezungumza Kiswahili: pochi moja ya familia, miji miwili"
              : "A PayPal agent that speaks Swahili: one family wallet, two cities"}
          </p>
          <LangToggle lang={lang} setLang={setLang} />
          <StartOver
            sw={sw}
            onReset={async () => {
              await fetch("/api/reset", { method: "POST" });
              setLocalAt("");
              setTab("app");
              setUnread(0);
              setResetKey((k) => k + 1);
              await refresh();
            }}
          />
        </div>
      </header>

      <div className="mx-auto mt-6 grid max-w-[80rem] items-start justify-items-center gap-8 lg:grid-cols-[1fr_19rem_1fr]">
        {/* Dar es Salaam: the real app */}
        <div className="w-full max-w-[24rem]">
          <City name="Dar es Salaam" zone="Africa/Dar_es_Salaam" who={sw ? "duka la Mzee Salim" : "Mzee Salim's shop"} />
          <Phone label="The shopkeeper's phone in Dar es Salaam">
            <div className="px-4 pb-5 pt-9">
              <div role="tablist" aria-label="How the shopkeeper talks to Sauti" className="mb-3 grid grid-cols-2 rounded-full bg-ink-2/70 p-1 text-sm">
                {(["app", "whatsapp"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={
                      "flex items-center justify-center gap-1.5 rounded-full py-1.5 font-semibold transition-colors " +
                      (tab === t ? "bg-white text-ink" : "text-ink-soft hover:text-white")
                    }
                  >
                    {t === "app" ? (
                      sw ? "Programu ya Sauti" : "Sauti app"
                    ) : (
                      <>
                        <MessageCircle aria-hidden className={"size-4 " + (tab === t ? "text-[#1f9d55]" : "")} /> WhatsApp
                        {unread > 0 && tab !== t && (
                          <span className="grid size-5 place-items-center rounded-full bg-marigold text-[0.7rem] text-ink">{unread}</span>
                        )}
                      </>
                    )}
                  </button>
                ))}
              </div>
              {/* Both stay mounted so switching tabs never loses a recording or a reply. */}
              <div hidden={tab !== "app"}>
                <TalkPanel
                  key={resetKey}
                  compact
                  lang={lang}
                  onDone={() => {
                    setLocalAt(new Date().toISOString());
                    refresh();
                  }}
                />
              </div>
              <div hidden={tab !== "whatsapp"}>
                <WhatsAppThread messages={chat} lang={lang} visible={tab === "whatsapp"} />
              </div>
            </div>
            <div className="min-h-[24rem] bg-paper">
              <Daftari data={data} freshPaymentAt={freshPaymentAt} compact />
            </div>
          </Phone>
        </div>

        {/* The journey: a real sequence, lit as each step happens */}
        <div className="w-full max-w-[24rem] lg:mt-24">
          <ol className="space-y-5" aria-label={sw ? "Pesa inavyosafiri" : "How the money moves"}>
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
                    {s.title} {s.arrow && <span className="text-marigold">{s.arrow}</span>}
                  </span>
                  <span className="block text-sm leading-snug text-ink-soft">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
          {/* What the agent just did, with its PayPal calls marked */}
          {activity && activity.actions.length > 0 && (
            <div key={activity.at} className="mt-6 border-t border-ink-2 pt-4 animate-in fade-in duration-500">
              {activity.source === "whatsapp" && activity.at > localAt && (
                <p className="flex items-start gap-2 text-sm text-ink-soft">
                  <MessageCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-[#25d366]" />
                  <span>
                    {sw ? "Kwenye WhatsApp" : "On WhatsApp"}:{" "}
                    <span className="text-white">“{!sw && activity.saidEn ? activity.saidEn : activity.said}”</span>
                    {!sw && activity.saidEn && (
                      <span lang="sw" className="mt-0.5 block text-xs italic">
                        Kiswahili: “{activity.said}”
                      </span>
                    )}
                  </span>
                </p>
              )}
              <AgentSteps actions={activity.actions} lang={lang} />
            </div>
          )}
        </div>

        {/* The family's city: the wallet, as the relative sees it */}
        <div className="w-full max-w-[24rem]">
          <City
            name={payer?.city ?? "New York"}
            zone={payer?.city === "Houston" ? "America/Chicago" : "America/New_York"}
            who={
              payer
                ? sw
                  ? `${RELATION_SW[payer.relation] ?? payer.relation} ${payer.name}`
                  : `her ${payer.relation} ${payer.name}`
                : sw
                  ? "familia"
                  : "the family"
            }
          />
          <Phone label={`${payer?.name ?? "The family"}'s phone`} light>
            <div className="flex min-h-full flex-col px-5 pb-5 pt-10 text-foreground">
              <p className="text-lg font-bold leading-tight">{she}'s grocery wallet</p>
              <p className="text-xs text-muted-foreground">at Duka la Mzee Salim, Dar es Salaam</p>

              <div className="mt-4 rounded-xl bg-ink p-4 text-white">
                <p className="text-xs text-ink-soft">Wallet balance</p>
                <p className="text-3xl font-bold tabular-nums">{tzs(fam?.balance ?? 0)}</p>
                <p className="text-sm text-ink-soft">
                  about ${(fam?.usd(fam.balance) ?? 0).toFixed(2)}
                  {fam && fam.owed > 0 && <span className="ml-2 text-[#ffb4ae]">and {tzs(fam.owed)} owed</span>}
                </p>
              </div>

              {fam?.request ? (
                <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
                  <p className="text-sm text-muted-foreground">Sauti asks you to add</p>
                  <p className="text-2xl font-bold tabular-nums">
                    ${fam.request.usd.toFixed(2)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">({tzs(fam.request.amountTzs)})</span>
                  </p>
                  <p className="mt-1 text-sm leading-snug">
                    {fam.balance <= 0 ? "The wallet is empty" : "The wallet is running low"}
                    {fam.owed > 0 ? `, and ${tzs(fam.owed)} is owed. That is cleared first.` : "."}
                  </p>
                  <PayButton invoiceId={fam.request.invoiceId} usd={fam.request.usd} name={payer?.name} />
                </div>
              ) : fam?.bill ? (
                <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
                  <p className="text-sm text-muted-foreground">Bill for {she}'s groceries</p>
                  <p className="text-2xl font-bold tabular-nums">
                    ${fam.usd(fam.bill.tzs).toFixed(2)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">({tzs(fam.bill.tzs)})</span>
                  </p>
                  <PayButton invoiceId={fam.bill.id} usd={fam.usd(fam.bill.tzs)} name={payer?.name} />
                </div>
              ) : fam?.notice ? (
                <div key={fam.notice.at} className="mt-4 rounded-xl bg-[#e8f5ec] p-4 text-paid animate-in fade-in duration-500">
                  <p className="flex items-center gap-2 font-bold">
                    <Check className="size-5" strokeWidth={3} />
                    {fam.notice.kind === "topup" ? "Topped up with PayPal" : "Paid with PayPal"}
                  </p>
                  <p className="mt-1 text-sm text-[#2a5a3c]">
                    ${fam.usd(fam.notice.amountTzs).toFixed(2)} went straight to the shop
                    {fam.notice.clearedTzs ? `. ${tzs(fam.notice.clearedTzs)} she owed is cleared.` : "."}
                  </p>
                </div>
              ) : null}

              <h3 className="mt-5 text-sm font-semibold">What it bought</h3>
              {fam?.purchases.length ? (
                <ul className="mt-2 divide-y rounded-xl bg-white px-4 shadow-sm">
                  {fam.purchases.slice(0, 5).map((e) => {
                    const tag = purchaseTag(e);
                    return (
                      <li key={e.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate">{e.item ?? "Groceries"}</span>
                          <span className={"block text-xs " + tag.cls}>{tag.text}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{tzs(e.amount)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing yet. When {she} shops, each item shows up here, so {payer?.name ?? "the family"} sees exactly where the
                  money goes.
                </p>
              )}
              <p className="mt-auto pt-6 text-center text-xs text-muted-foreground">Money moves with PayPal, straight to the shop</p>
            </div>
          </Phone>
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-[80rem] text-xs text-ink-soft/80">
        {sw
          ? `Onyesho kwenye sandbox ya PayPal. Simu ya kushoto ni programu halisi; ya kulia inaonyesha anachokiona ${payerName}, kwa Kiingereza kwa sababu anaishi ${payer?.city ?? "nje"}, na inasasishwa PayPal inapothibitisha malipo.`
          : "Demo view on PayPal's sandbox. The left phone is the live app; the right phone shows what the family sees, updated when PayPal confirms a payment."}
      </p>
    </main>
  );
}
