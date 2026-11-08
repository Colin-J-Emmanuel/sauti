"use client";

// Bare-bones UI so the loop works end to end. Design polish comes later.
import { useEffect, useRef, useState } from "react";

type Action = { tool: string; args: unknown; result: unknown };
type Entry = {
  id: string;
  type: string;
  counterparty: string;
  item?: string;
  amount: number;
  currency: string;
  paypalInvoiceId?: string;
  paidAt?: string;
  note?: string;
};
type Notice = { invoiceId: string; customer: string; payer?: string; amountTzs: number; at: string };

export default function Home() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const seen = useRef<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [actions, setActions] = useState<Action[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const refresh = async () => {
    const data = await (await fetch("/api/ledger")).json();
    setEntries(data.entries);
    const latest: Notice | undefined = data.notices?.[0];
    if (latest && seen.current !== null && latest.at !== seen.current) {
      setNotice(latest); // a PayPal payment arrived via webhook since we last looked
      try {
        const u = new SpeechSynthesisUtterance(
          `${latest.payer?.split(" ")[0] ?? "Familia"} amelipa shilingi ${latest.amountTzs} kwa ${latest.customer}`,
        );
        u.lang = "sw-TZ";
        speechSynthesis.speak(u);
      } catch {}
    }
    seen.current = latest?.at ?? "";
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  async function send(form: FormData) {
    setBusy(true);
    setReply("");
    setActions([]);
    try {
      const res = await (await fetch("/api/agent", { method: "POST", body: form })).json();
      setReply(res.reply ?? res.error);
      setActions(res.actions ?? []);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks.current, { type: rec.mimeType });
      const f = new FormData();
      f.append("audio", new File([blob], "note.webm", { type: rec.mimeType }));
      send(f);
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1 style={{ marginBottom: 4 }}>Sauti</h1>
      <p style={{ marginTop: 0, color: "#555" }}>Ongea, tunaandika. (Speak, we keep the books.)</p>

      {notice && (
        <div
          onClick={() => setNotice(null)}
          style={{ background: "#1f6f4a", color: "#fff", padding: 14, borderRadius: 12, marginBottom: 12 }}
        >
          💸 <b>{notice.payer ?? "Familia"}</b> amelipa {notice.amountTzs.toLocaleString()} TZS kwa{" "}
          {notice.customer} kupitia PayPal.
          <div style={{ opacity: 0.85, fontSize: 13 }}>
            EN: {notice.payer ?? "Family"} paid {notice.customer}&apos;s tab via PayPal.
          </div>
        </div>
      )}

      <button
        onClick={toggleRecord}
        disabled={busy}
        style={{
          width: "100%", padding: 24, fontSize: 20, borderRadius: 16, border: 0, color: "#fff",
          background: recording ? "#c0392b" : "#1f6f4a",
        }}
      >
        {busy ? "Inafanya kazi…" : recording ? "■ Simamisha (stop)" : "🎙 Bonyeza uongee (tap to speak)"}
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const f = new FormData();
          f.append("text", text);
          send(f);
          setText("");
        }}
        style={{ display: "flex", gap: 8, marginTop: 12 }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…au andika hapa (or type)"
          style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid #ccc" }}
        />
        <button disabled={busy} style={{ padding: "0 16px", borderRadius: 10 }}>Tuma</button>
      </form>

      {reply && (
        <div style={{ background: "#fff", padding: 12, borderRadius: 12, marginTop: 16, whiteSpace: "pre-wrap" }}>
          {reply}
        </div>
      )}
      {actions.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>What the agent did ({actions.length})</summary>
          <pre style={{ fontSize: 11, overflowX: "auto" }}>{JSON.stringify(actions, null, 2)}</pre>
        </details>
      )}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Daftari (Ledger)</h2>
      {entries.map((e) => (
        <div key={e.id} style={{ background: "#fff", padding: 10, borderRadius: 10, marginBottom: 6 }}>
          <b>{e.counterparty}</b> · {e.type} · {e.amount.toLocaleString()} {e.currency}
          {e.item ? ` · ${e.item}` : ""}
          {e.paidAt ? " · ✅ paid via PayPal" : e.paypalInvoiceId ? " · 🧾 billed to family abroad" : ""}
        </div>
      ))}
    </main>
  );
}
