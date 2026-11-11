"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentSteps } from "@/components/agent-steps";
import type { AgentResponse } from "@/lib/types";
import type { Lang } from "@/components/whatsapp-thread";

// Phrases a judge who doesn't speak Swahili can tap to try the full flow.
const TRY_THESE = [
  { sw: "Mama Asha amechukua mchele wa 15,000.", en: "Mama Asha took rice worth 15,000." },
  { sw: "Nani hajalipa?", en: "Who hasn't paid? (Sauti asks PayPal)" },
  { sw: "Mkumbushe Juma.", en: "Remind Juma, by PayPal." },
  { sw: "Mama Asha amechukua mafuta ya 8,000 na sukari ya 4,500.", en: "She took oil (8,000) and sugar (4,500)." },
  { sw: "Pochi ya Mama Asha ina kiasi gani?", en: "How much is in Mama Asha's wallet?" },
  { sw: "Naweza kumkopesha Mama Asha?", en: "Can I give Mama Asha credit?" },
];

type Exchange = { said: string; saidEn?: string; spoken: boolean; reply: AgentResponse };

function splitReply(reply = "") {
  const [sw, ...rest] = reply.split(/\n?\s*EN:\s*/);
  return { sw: sw.trim(), en: rest.join(" ").trim() };
}

export function TalkPanel({
  onDone,
  compact = false,
  lang,
}: {
  onDone: (reply?: AgentResponse) => void;
  compact?: boolean;
  /** Set on the demo screen: show one language. Unset (the shopkeeper's app): Swahili with English under it. */
  lang?: Lang;
}) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState("");
  const [last, setLast] = useState<Exchange | null>(null);
  const [pending, setPending] = useState<{ said: string; spoken: boolean } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (state !== "recording") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function send(form: FormData, said: string, spoken: boolean) {
    setState("working");
    setPending({ said, spoken });
    let reply: AgentResponse | undefined;
    try {
      const res = (await (await fetch("/api/agent", { method: "POST", body: form })).json()) as AgentResponse;
      setLast({ said: spoken ? (res.transcript ?? "") : said, saidEn: res.saidEn, spoken, reply: res });
      reply = res;
    } catch {
      setLast({ said, spoken, reply: { error: "Sauti couldn't be reached. Check your connection and try again." } });
    } finally {
      setPending(null);
      setState("idle");
      onDone(reply);
    }
  }

  function sendText(value: string) {
    const v = value.trim();
    if (!v || state !== "idle") return;
    const f = new FormData();
    f.append("text", v);
    setText("");
    send(f, v, false);
  }

  async function toggleMic() {
    if (state === "recording") {
      recorder.current?.stop();
      return;
    }
    if (state !== "idle") return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setLast({ said: "", spoken: true, reply: { error: "Microphone access is blocked. Allow it in the browser's address bar, or type instead." } });
      return;
    }
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks.current, { type: rec.mimeType });
      const f = new FormData();
      // Safari/iPhone records audio/mp4, Chrome records audio/webm: name the file to match.
      const ext = rec.mimeType.includes("mp4") ? "m4a" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
      f.append("audio", new File([blob], `note.${ext}`, { type: rec.mimeType }));
      send(f, "", true);
    };
    rec.start();
    recorder.current = rec;
    setState("recording");
  }

  const reply = last?.reply.reply ? splitReply(last.reply.reply) : null;

  return (
    <section aria-label="Talk to Sauti" className="flex flex-col text-white">
      {/* Mic */}
      <div className={compact ? "flex items-center gap-4 pt-3" : "flex flex-col items-center pt-6 pb-2"}>
        <div className="relative">
          {state === "recording" && <span aria-hidden className="mic-ring absolute inset-0 rounded-full bg-marigold" />}
          <button
            onClick={toggleMic}
            disabled={state === "working"}
            aria-label={state === "recording" ? "Stop recording" : "Start recording"}
            className={
              "relative grid place-items-center rounded-full bg-marigold text-ink transition-transform disabled:opacity-60 " +
              (compact
                ? "size-16 shadow-[0_5px_0_0_var(--marigold-deep)] active:translate-y-[3px] active:shadow-[0_2px_0_0_var(--marigold-deep)]"
                : "size-36 shadow-[0_10px_0_0_var(--marigold-deep)] active:translate-y-[6px] active:shadow-[0_4px_0_0_var(--marigold-deep)] sm:size-40")
            }
          >
            {state === "working" ? (
              <Loader2 className={compact ? "size-7 animate-spin" : "size-12 animate-spin"} />
            ) : state === "recording" ? (
              <Square className={compact ? "size-6 fill-current" : "size-11 fill-current"} />
            ) : (
              <Mic className={compact ? "size-7" : "size-14"} strokeWidth={2.2} />
            )}
          </button>
        </div>
        <div className={compact ? "" : "text-center"}>
        <p lang={lang === "en" ? undefined : "sw"} className={compact ? "text-lg font-semibold" : "mt-6 text-xl font-semibold"} aria-live="polite">
          {lang === "en"
            ? state === "recording"
              ? `Listening… 0:${String(seconds).padStart(2, "0")}`
              : state === "working"
                ? "Sauti is writing it down…"
                : "Tap and speak Swahili"
            : state === "recording"
              ? `Nakusikiliza… 0:${String(seconds).padStart(2, "0")}`
              : state === "working"
                ? "Sauti inaandika…"
                : "Bonyeza uongee"}
        </p>
        {lang !== "sw" && (
          <p className="text-sm text-ink-soft">
            {state === "recording"
              ? "Tap again when you're done."
              : state === "working"
                ? lang === "en" ? "Usually a few seconds." : "Writing it down."
                : lang === "en" ? "Or tap an example below" : "Tap and speak in Swahili"}
          </p>
        )}
        {lang === "sw" && (
          <p lang="sw" className="text-sm text-ink-soft">
            {state === "recording" ? "Bonyeza tena ukimaliza." : state === "working" ? "Inachukua sekunde chache." : "Au chagua mfano hapa chini"}
          </p>
        )}
        </div>
      </div>

      {/* Type instead */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendText(text);
        }}
        className={compact ? "mt-4 flex gap-2" : "mt-5 flex gap-2"}
      >
        <label htmlFor="say" className="sr-only">
          Type a message instead
        </label>
        <Input
          id="say"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={lang === "en" ? "…or type here" : lang === "sw" ? "…au andika hapa" : "…au andika hapa (or type)"}
          disabled={state !== "idle"}
          className="h-11 border-ink-2 bg-ink-2/60 text-white placeholder:text-ink-soft"
        />
        <Button type="submit" size="icon" disabled={state !== "idle" || !text.trim()} aria-label="Send" className="size-11 bg-white text-ink hover:bg-white/90">
          <ArrowUp className="size-5" />
        </Button>
      </form>

      {/* Conversation */}
      <div className={compact ? "mt-4" : "mt-6 min-h-24"} aria-live="polite">
        {pending && (
          <p className={"ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-ink-2 " + (compact ? "px-3 py-2 text-sm" : "px-4 py-2.5 text-[0.95rem]")}>
            {pending.spoken ? "🎙 …" : pending.said}
          </p>
        )}
        {!pending && last && (
          <>
            {last.said && (
              <p className={"ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-ink-2 " + (compact ? "px-3 py-2 text-sm" : "px-4 py-2.5 text-[0.95rem]")}>
                {last.spoken && <Mic aria-label="Spoken" className="mr-1.5 inline size-3.5 -translate-y-px text-marigold" />}
                {lang === "en" && last.saidEn ? last.saidEn : last.said}
                {lang === "en" && last.saidEn && (
                  <span lang="sw" className="mt-0.5 block text-xs italic text-white/60">
                    Kiswahili: {last.said}
                  </span>
                )}
              </p>
            )}
            <div className="mt-3 rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-ink">
              {last.reply.error ? (
                <p className="text-[0.95rem] text-margin">{last.reply.error}</p>
              ) : (
                <>
                  <p lang={lang === "en" ? undefined : "sw"} className={compact ? "text-[0.92rem] leading-snug" : "text-[1.05rem] leading-snug"}>
                    {lang === "en" ? reply?.en || reply?.sw : reply?.sw}
                  </p>
                  {!lang && reply?.en && (
                    <p className={"leading-snug text-muted-foreground " + (compact ? "mt-1.5 text-xs" : "mt-2 text-sm")}>{reply.en}</p>
                  )}
                </>
              )}
            </div>
            {!compact && <AgentSteps actions={last.reply.actions ?? []} lang={lang} />}
          </>
        )}
        {!pending && !last && (
          <div>
            <h3 className="text-sm font-semibold text-ink-soft">
              {lang === "sw" ? "Sema, au chagua mmoja" : "Try saying, or tap one"}
            </h3>
            <ul className="mt-2 space-y-2">
              {TRY_THESE.map((t) => (
                <li key={t.sw}>
                  <button
                    onClick={() => sendText(t.sw)}
                    disabled={state !== "idle"}
                    className={"w-full rounded-xl border border-ink-2 text-left transition-colors hover:bg-ink-2 " + (compact ? "px-3 py-2" : "px-4 py-2.5")}
                  >
                    <span lang="sw" className={compact ? "block text-sm" : "block text-[0.95rem]"}>{t.sw}</span>
                    {(!compact || lang === "en") && <span className={"block text-ink-soft " + (compact ? "text-xs" : "text-sm")}>{t.en}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {!pending && last && (
        <details className="mt-5 text-sm text-ink-soft">
          <summary className="cursor-pointer">{lang === "sw" ? "Jaribu mengine" : "More things to try"}</summary>
          <ul className="mt-2 space-y-1.5">
            {TRY_THESE.map((t) => (
              <li key={t.sw}>
                <button onClick={() => sendText(t.sw)} disabled={state !== "idle"} className="text-left text-white underline-offset-4 hover:underline">
                  {t.sw}
                </button>
                {lang !== "sw" && <span className="block">{t.en}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
