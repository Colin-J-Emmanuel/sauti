"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

export type Lang = "en" | "sw";

/** Sauti writes "Swahili … \n\n_EN: English_". Show the part that matches the chosen language. */
export function pickLang(text: string, lang: Lang) {
  const [sw, ...rest] = text.split(/\n+\s*_?EN:\s*/);
  const en = rest.join(" ").replace(/_\s*$/, "").trim();
  return lang === "en" && en ? en : sw.trim();
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** WhatsApp's own markup: *bold* and _italic_. */
function Markup({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <strong key={i}>{p.slice(1, -1)}</strong>
        ) : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? (
          <em key={i} className="opacity-80">
            {p.slice(1, -1)}
          </em>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

// A fixed, gentle waveform: it signals "voice note" without pretending to show the real audio.
const BARS = [3, 6, 10, 7, 12, 9, 14, 8, 11, 6, 13, 9, 7, 11, 5, 9, 12, 6, 8, 4];

function VoiceNote({ m, lang }: { m: ChatMessage; lang: Lang }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  const secs = Math.round(duration ?? 0);

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <button
          onClick={toggle}
          disabled={!m.audio}
          aria-label={playing ? "Pause voice note" : "Play voice note"}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-marigold text-ink disabled:opacity-50"
        >
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
        </button>
        <span aria-hidden className="flex h-6 items-center gap-[2px]">
          {BARS.map((h, i) => (
            <span
              key={i}
              className={"w-[3px] rounded-full " + (i / BARS.length < progress ? "bg-marigold" : "bg-white/45")}
              style={{ height: h * 1.5 }}
            />
          ))}
        </span>
        <span className="text-xs tabular-nums text-white/70">{duration ? `0:${String(secs).padStart(2, "0")}` : ""}</span>
      </div>
      {m.audio && (
        <audio
          ref={ref}
          src={`/api/whatsapp/media/${m.audio}`}
          preload="metadata"
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
        />
      )}
      {m.transcript ? (
        <Said original={m.transcript} en={m.textEn} lang={lang} />
      ) : (
        <p className="mt-1.5 text-[0.8rem] leading-snug text-white/75">{lang === "en" ? "Sauti is listening…" : "Sauti inasikiliza…"}</p>
      )}
    </div>
  );
}

/** What the shopkeeper said: in English mode, the translation first and the Swahili original under it. */
function Said({ original, en, lang, voice = true }: { original: string; en?: string; lang: Lang; voice?: boolean }) {
  const mark = voice ? "🎙 " : "";
  if (lang === "sw" || !en) return <p className={voice ? "mt-1.5 text-[0.8rem] leading-snug text-white/75" : ""}>{voice ? `${mark}“${original}”` : original}</p>;
  return (
    <div className={voice ? "mt-1.5" : ""}>
      <p className={voice ? "text-[0.85rem] leading-snug text-white" : ""}>{voice ? `${mark}“${en}”` : en}</p>
      <p lang="sw" className="mt-0.5 text-[0.75rem] italic leading-snug text-white/60">
        {voice ? `Kiswahili: “${original}”` : `Kiswahili: ${original}`}
      </p>
    </div>
  );
}

export function WhatsAppThread({ messages, lang = "en", visible = true }: { messages: ChatMessage[]; lang?: Lang; visible?: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const last = messages.at(-1);
  // Keep the newest message in view; scroll only the thread, never the page or the phone.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const toBottom = () => (el.scrollTop = el.scrollHeight);
    toBottom();
    const t = setTimeout(toBottom, 350); // after the bubble's entrance animation
    return () => clearTimeout(t);
  }, [last?.id, last?.transcript, last?.textEn, messages.length, lang, visible]); // a hidden tab has no height: scroll again when shown

  return (
    <section aria-label="WhatsApp conversation with Sauti" className="text-white">
      <header className="flex items-center gap-3 border-b border-ink-2 pb-3">
        <span className="grid size-9 place-items-center rounded-full bg-marigold text-sm font-extrabold text-ink">S</span>
        <span className="leading-tight">
          <span className="block font-semibold">Sauti</span>
          <span className="block text-xs text-ink-soft">
            {lang === "en" ? "via WhatsApp, live from the shopkeeper's phone" : "kupitia WhatsApp, moja kwa moja kutoka simu ya muuza duka"}
          </span>
        </span>
      </header>

      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm leading-relaxed text-ink-soft">
          {lang === "en" ? "No WhatsApp messages yet." : "Bado hakuna ujumbe wa WhatsApp."}
          <br />
          {lang === "en"
            ? "Send Sauti a voice note from your phone and it appears here as it happens."
            : "Mtumie Sauti ujumbe wa sauti kutoka simu yako, nao utaonekana hapa papo hapo."}
        </p>
      ) : (
        <ol ref={list} className="max-h-[22rem] space-y-2 overflow-y-auto py-3 pr-1" aria-live="polite">
          {messages.map((m) => {
            const mine = m.from === "shop";
            // Sauti's replies repeat the transcript at the top; the voice note already shows it.
            const text = pickLang(m.text?.replace(/^🎙[^\n]*\n+/, "") ?? "", lang);
            return (
              <li key={m.id} className={"flex animate-in fade-in slide-in-from-bottom-1 duration-300 " + (mine ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[85%] rounded-2xl px-3 py-2 text-[0.85rem] leading-snug " +
                    (mine
                      ? "rounded-br-sm bg-ink-2"
                      : m.kind === "alert"
                        ? "rounded-bl-sm bg-paid"
                        : m.kind === "ack"
                          ? "rounded-bl-sm bg-white/10 text-white/80"
                          : "rounded-bl-sm bg-white text-ink")
                  }
                >
                  {m.kind === "voice" ? (
                    <VoiceNote m={m} lang={lang} />
                  ) : mine ? (
                    <Said original={m.text ?? ""} en={m.textEn} lang={lang} voice={false} />
                  ) : (
                    <p lang={lang === "sw" ? "sw" : undefined} className="whitespace-pre-line">
                      <Markup text={text} />
                    </p>
                  )}
                  <span className={"mt-1 block text-right text-[0.65rem] " + (!mine && m.kind === "reply" ? "text-muted-foreground" : "text-white/60")}>
                    {time(m.at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {messages.length > 0 && (
        <p className="pt-1 text-[0.7rem] leading-snug text-ink-soft/80">
          {lang === "en"
            ? "Sauti writes to the shop in Kiswahili with an English line. Showing the English."
            : "Sauti anaandikia duka kwa Kiswahili, pamoja na mstari wa Kiingereza. Unaona Kiswahili."}
        </p>
      )}
    </section>
  );
}
