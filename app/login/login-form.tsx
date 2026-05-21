"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    setLoading(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Login gagal.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={onSubmit}>
        <h1>Admin Chatbot</h1>
        <p className="muted">Masuk untuk mengelola RAG, chat memory, dan penggunaan chatbot.</p>

        <div className="field">
          <label htmlFor="username">Email admin</label>
          <input
            className="input"
            id="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="field">
          <button className="button" disabled={loading} type="submit">
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </div>
      </form>
    </main>
  );
}
