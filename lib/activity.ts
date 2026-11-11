import { promises as fs } from "fs";
import path from "path";

// The last thing Sauti did, from any door (the app or WhatsApp), so the demo screen can show
// the agent's steps, PayPal calls included, even when the shopkeeper spoke on WhatsApp.
export type Activity = {
  at: string;
  source: "app" | "whatsapp";
  said: string;
  spoken: boolean;
  reply: string;
  actions: { tool: string; args: unknown; result: unknown }[];
};

const FILE = path.join(process.cwd(), "data", "activity.json");

export async function recordActivity(a: Omit<Activity, "at">) {
  // Keep tool results small: the page only needs enough to describe each step.
  const slim = a.actions.map((x) => ({ ...x, result: JSON.parse(JSON.stringify(x.result ?? null).slice(0, 4000) || "null") }));
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ ...a, actions: slim, at: new Date().toISOString() }));
  } catch {
    /* best effort */
  }
}

export async function lastActivity(): Promise<Activity | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Activity;
  } catch {
    return null;
  }
}
