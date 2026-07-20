import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

// Endpoint ringan untuk polling status sesi dari client (AdminApp).
// Sengaja tidak pakai getCurrentAdmin() penuh di response supaya payloadnya
// kecil — cuma untuk tahu "masih login atau tidak", dipanggil berkala.
export async function GET() {
  const authenticated = await isAuthenticated();
  return NextResponse.json({ authenticated }, { status: authenticated ? 200 : 401 });
}