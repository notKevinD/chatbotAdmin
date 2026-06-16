import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Agent Chatbot Admin",
  description: "Admin panel untuk pengelolaan RAG, chat memory, dan analitik chatbot n8n."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
