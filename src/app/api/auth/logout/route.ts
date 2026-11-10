import { NextResponse } from "next/server";
import { clearSession } from "@/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/", request.url), 303);
}
