import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { purchasingBoard } from "@/lib/purchasing.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";
import { canSeeMoney } from "@/lib/optionalModules";
import { readOptionalModules } from "@/lib/optionalModules.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await authorizeModule("purchasing");
  if (error) return error;
  try {
    return NextResponse.json(await purchasingBoard(canSeeMoney(user, readOptionalModules())), { headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
