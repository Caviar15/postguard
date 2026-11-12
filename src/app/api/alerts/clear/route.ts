import { NextResponse } from "next/server";
import { clearWatchGrant } from "@/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await clearWatchGrant();
  return NextResponse.redirect(new URL("/alerts/setup", request.url), 303);
}
