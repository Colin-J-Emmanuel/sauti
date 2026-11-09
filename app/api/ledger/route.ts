import { NextResponse } from "next/server";
import { activeEntries, balances, latestNotices } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    entries: (await activeEntries()).reverse(),
    balances: await balances(),
    notices: await latestNotices(),
  });
}
