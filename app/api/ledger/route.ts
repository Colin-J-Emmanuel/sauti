import { NextResponse } from "next/server";
import { balances, latestNotices, listEntries } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    entries: (await listEntries()).reverse(),
    balances: await balances(),
    notices: await latestNotices(),
  });
}
