import { promises as fs } from "fs";
import path from "path";
import type { ModelMessage } from "ai";

// Short-term memory so follow-ups work: "Pia amechukua sukari" (she also took sugar),
// "tuma bili kwa mwanawe" (send the bill to her son).
// Each turn keeps the FULL exchange — including which tools ran and what they returned —
// so the model knows what it actually did, not just what it said. (Remembering only the
// words made the model think earlier sales were never saved, and record them twice.)
// Last few turns only, forgotten after a quiet spell.
type Turn = { at: number; messages: ModelMessage[] };

const FILE = path.join(process.cwd(), "data", "history.json");
const MAX_TURNS = 4;
const IDLE_MS = 30 * 60 * 1000;

async function readTurns(): Promise<Turn[]> {
  try {
    const turns = JSON.parse(await fs.readFile(FILE, "utf8")) as Turn[];
    if (!Array.isArray(turns) || !turns.every((t) => Array.isArray(t?.messages))) return []; // old format
    const last = turns.at(-1);
    return last && Date.now() - last.at < IDLE_MS ? turns : [];
  } catch {
    return [];
  }
}

export async function loadHistory(): Promise<ModelMessage[]> {
  return (await readTurns()).flatMap((t) => t.messages);
}

/** Save one whole turn: the trader's message plus everything the agent did in response. */
export async function appendTurn(messages: ModelMessage[]) {
  const turns = [...(await readTurns()), { at: Date.now(), messages }].slice(-MAX_TURNS);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(turns));
}

export async function clearHistory() {
  await fs.rm(FILE, { force: true });
}
