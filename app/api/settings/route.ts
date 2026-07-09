import { NextResponse } from "next/server";
import { isNuvioConfigured } from "@/lib/nuvio";
import { getAppSettings, isConfigured, setAppSetting } from "@/lib/supabase";

export const runtime = "nodejs";

// Whitelisted settings and their expected value type. Add entries here as new
// settings ship; unknown keys are rejected.
const SETTING_TYPES: Record<string, "boolean"> = {
  nuvio_sync_enabled: "boolean",
};

export async function GET() {
  try {
    const stored = await getAppSettings();
    return NextResponse.json({
      configured: isConfigured(),
      nuvioConfigured: isNuvioConfigured(),
      settings: {
        nuvio_sync_enabled: stored.nuvio_sync_enabled !== false,
      },
    });
  } catch (err) {
    console.error("[/api/settings GET]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not load settings: ${message}` }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const key = typeof body?.key === "string" ? body.key : "";
    const expected = SETTING_TYPES[key];
    if (!expected || typeof body?.value !== expected) {
      return NextResponse.json({ error: "Invalid setting key or value" }, { status: 400 });
    }
    await setAppSetting(key, body.value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/settings PUT]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not save setting: ${message}` }, { status: 500 });
  }
}
