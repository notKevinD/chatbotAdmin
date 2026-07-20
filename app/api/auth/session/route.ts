import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";

// Dipakai untuk dua hal:
// 1. Polling berkala dari AdminApp (deteksi sesi habis → auto redirect).
// 2. Sumber info role untuk frontend (super_admin vs admin biasa), supaya
//    UI bisa sembunyikan tombol aksi sensitif. Ini HANYA untuk kenyamanan
//    tampilan — proteksi sesungguhnya tetap dilakukan di tiap API route
//    lewat requireSuperAdmin(), bukan mengandalkan frontend.
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role }
  });
}