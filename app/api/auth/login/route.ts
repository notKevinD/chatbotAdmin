import { NextResponse } from "next/server";
import { loginAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || body.email || "");
  const password = String(body.password || "");

  let ok = false;

  try {
    ok = await loginAdmin(username, password, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login gagal.";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Terlalu banyak") ? 429 : 500 }
    );
  }

  if (!ok) {
    return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
