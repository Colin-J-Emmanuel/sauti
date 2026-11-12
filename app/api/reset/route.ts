import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { resetLedger } from "@/lib/ledger";
import { clearChat } from "@/lib/chatlog";

export const runtime = "nodejs";

// "Start over" on /demo: every judge can run the whole loop from an empty daftari.
// Keeps the customers and the shopkeeper's WhatsApp number, so WhatsApp keeps working.
export async function POST() {
  const data = path.join(process.cwd(), "data");
  await resetLedger();
  await clearChat();
  await Promise.all(
    ["history.json", "activity.json"].map((f) => fs.rm(path.join(data, f), { force: true })),
  );
  return NextResponse.json({ ok: true });
}
