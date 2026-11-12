import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

// A short mirror of the WhatsApp conversation with the shopkeeper, so the demo screen can show it live.
// No phone numbers are kept here. Voice notes are saved briefly so they can be played back on screen;
// everything is erased when the server restarts (and only the last few messages are kept).

export type ChatMessage = {
  id: string;
  at: string;
  from: "shop" | "sauti";
  kind: "text" | "voice" | "ack" | "reply" | "alert";
  text?: string; // what was typed, or Sauti's message
  transcript?: string; // for a voice note, once Sauti has heard it
  textEn?: string; // English translation of what the shopkeeper typed or said
  audio?: string; // media id served by /api/whatsapp/media/<id>
  seconds?: number;
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "chat.json");
export const MEDIA_DIR = path.join(DIR, "wa-media");
const KEEP = 40;

let queue: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

async function read(): Promise<ChatMessage[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function chatMessages(): Promise<ChatMessage[]> {
  return read();
}

export function logChat(m: Omit<ChatMessage, "id" | "at"> & { id?: string }): Promise<ChatMessage> {
  return locked(async () => {
    const all = await read();
    const msg: ChatMessage = { ...m, id: m.id ?? randomUUID(), at: new Date().toISOString() };
    all.push(msg);
    const kept = all.slice(-KEEP);
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(kept));
    // Drop audio files for messages that fell off the end.
    const gone = all.slice(0, -KEEP).map((x) => x.audio).filter(Boolean) as string[];
    await Promise.all(gone.map((a) => fs.rm(path.join(MEDIA_DIR, a), { force: true })));
    return msg;
  });
}

export function updateChat(id: string, patch: Partial<ChatMessage>) {
  return locked(async () => {
    const all = await read();
    const m = all.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    await fs.writeFile(FILE, JSON.stringify(all));
  });
}

const EXT: Record<string, string> = { "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr" };

/** Save a voice note so the demo screen can play it. Returns the file name used as its id. */
export async function saveVoiceNote(data: Uint8Array, mimeType: string): Promise<string> {
  const base = mimeType.split(";")[0].trim();
  const name = `${randomUUID()}.${EXT[base] ?? "ogg"}`;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, name), data);
  return name;
}

/** Clear the WhatsApp mirror (messages and saved voice notes). */
export function clearChat() {
  return locked(async () => {
    await fs.rm(FILE, { force: true });
    await fs.rm(MEDIA_DIR, { recursive: true, force: true });
  });
}
