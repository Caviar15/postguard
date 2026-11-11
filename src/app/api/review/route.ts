import { nextAuthStep } from "@/auth/flow";
import { readSession } from "@/auth/session";
import { reviewBudgetKey, reviewImage } from "@/ai/review";
import { isHttpUrl } from "@/domain/urls";
import { sessionHasImage } from "@/scan/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await readSession();
  if (!session || nextAuthStep(session) !== "ok") {
    return Response.json(
      { ok: false, reason: "reconnect", message: "Connect Buffer again before asking for a suggestion." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as { imageUrl?: unknown; caption?: unknown; service?: unknown } | null;
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  if (!isHttpUrl(imageUrl) || !sessionHasImage(session.refreshToken ?? session.accessToken, imageUrl)) {
    return Response.json({ ok: false, reason: "invalid", message: "That image is not in the latest scan." }, { status: 400 });
  }

  const result = await reviewImage({
    imageUrl,
    caption: typeof body?.caption === "string" ? body.caption.slice(0, 2_000) : "",
    service: typeof body?.service === "string" ? body.service.slice(0, 40) : "unknown",
    budgetKey: reviewBudgetKey(session.refreshToken ?? session.accessToken),
  });
  return Response.json(result);
}
