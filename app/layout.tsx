import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin Chatbot PMB | UBL",
  description: "Panel administrasi chatbot PMB Universitas Bandar Lampung.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body suppressHydrationWarning={true}>
        {children}
      </body>
    </html>
  );
}