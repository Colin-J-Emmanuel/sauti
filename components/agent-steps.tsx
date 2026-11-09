"use client";

import { AlertTriangle, BookOpenCheck, Eraser, FileText, Link2, Search, Send, Wallet } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AgentAction } from "@/lib/types";

const tzs = (n: number) => `${Math.round(n).toLocaleString("en-US")} TZS`;

function parse(v: unknown): any {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function failed(result: unknown): string | null {
  const r = parse(result);
  if (r && typeof r === "object" && "ok" in r && (r as any).ok === false) return (r as any).message ?? "Request failed";
  if (typeof r === "string" && /error|failed/i.test(r) && r.length < 300) return r;
  return null;
}

type Step = { icon: React.ComponentType<{ className?: string }>; text: string; paypal?: boolean; error?: string | null };

/** Turn the agent's tool calls into sentences a shopkeeper (or a judge) can read. */
function describe(actions: AgentAction[]): Step[] {
  const invoiceTotal: Record<string, number> = {};
  let lastRecipient = "the family";

  return actions.map((a) => {
    const args = a.args ?? {};
    const res = parse(a.result);
    const error = failed(a.result);
    switch (a.tool) {
      case "record_entry": {
        const cp = res?.counterparty ?? args.counterparty;
        const what = args.type === "payment_received" ? "payment" : (args.item ?? "sale");
        return { icon: BookOpenCheck, text: `Wrote ${what}, ${tzs(args.amount)}, in ${cp}'s tab`, error };
      }
      case "get_family_tab": {
        if (res?.payer) lastRecipient = `${res.payer.name} in ${res.payer.city}`;
        const n = res?.entries?.length ?? 0;
        return {
          icon: Search,
          text: res?.payer
            ? `Found ${n} unbilled item${n === 1 ? "" : "s"} on ${res.customer}'s tab (${tzs(res.totalTzs ?? 0)}), paid by ${lastRecipient}`
            : `Checked ${res?.customer ?? args.customer}'s tab: nobody abroad is linked`,
          error,
        };
      }
      case "get_balances":
        return { icon: Search, text: "Checked who owes the shop money", error };
      case "recent_entries":
        return { icon: Search, text: "Read the latest entries in the daftari", error };
      case "remove_entries": {
        const n = res?.removed?.length ?? 0;
        return { icon: Eraser, text: `Crossed out ${n} mistaken entr${n === 1 ? "y" : "ies"}`, error };
      }
      case "create_invoice": {
        const total = (args.items ?? []).reduce(
          (s: number, it: any) => s + Number(it?.unit_amount?.value ?? 0) * Number(it?.quantity ?? 1),
          0,
        );
        const who = args.primary_recipients?.[0]?.billing_info?.name?.given_name;
        if (who) lastRecipient = who;
        const id = typeof res?.href === "string" ? res.href.split("/").pop() : undefined;
        if (id) invoiceTotal[id] = total;
        return { icon: FileText, paypal: true, text: `Created a PayPal invoice for $${total.toFixed(2)}`, error };
      }
      case "send_invoice":
        return { icon: Send, paypal: true, text: `Sent the invoice to ${lastRecipient}`, error };
      case "send_invoice_reminder":
        return { icon: Send, paypal: true, text: `Sent ${lastRecipient} a payment reminder`, error };
      case "link_invoice_to_entries": {
        const n = args.entryIds?.length ?? 0;
        return { icon: Link2, text: `Marked ${n} item${n === 1 ? "" : "s"} as billed, so they can't be billed twice`, error };
      }
      default:
        return { icon: Wallet, paypal: a.tool.includes("invoice"), text: a.tool.replaceAll("_", " "), error };
    }
  });
}

export function AgentSteps({ actions }: { actions: AgentAction[] }) {
  if (!actions.length) return null;
  const steps = describe(actions);
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-ink-soft">What Sauti did</h3>
      <ol className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-[0.95rem] leading-snug text-white">
            <span
              className={
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full " +
                (s.error ? "bg-margin text-white" : s.paypal ? "bg-[#ffc439] text-ink" : "bg-ink-2 text-ink-soft")
              }
              aria-hidden
            >
              {s.error ? <AlertTriangle className="size-3.5" /> : <s.icon className="size-3.5" />}
            </span>
            <span>
              {s.text}
              {s.paypal && !s.error && <span className="ml-2 text-xs font-semibold text-[#ffc439]">PayPal</span>}
              {s.error && <span className="block text-sm text-[#ffb4ae]">PayPal said: {s.error}</span>}
            </span>
          </li>
        ))}
      </ol>
      <Collapsible className="mt-3">
        <CollapsibleTrigger className="text-xs text-ink-soft underline-offset-4 hover:underline">
          Show the technical details
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-black/30 p-3 text-[11px] leading-relaxed text-ink-soft">
            {JSON.stringify(actions, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
