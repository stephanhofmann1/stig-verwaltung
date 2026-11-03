"use client";

import { useState } from "react";

export function MieterAnmeldung() {
  const [email, setEmail] = useState("");
  const [stand, setStand] = useState<"bereit" | "laeuft" | "fertig">("bereit");
  const [hinweis, setHinweis] = useState("");

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setStand("laeuft");
    const r = await fetch("/api/mieter/anmelden", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = (await r.json().catch(() => ({}))) as { hinweis?: string };
    setHinweis(d.hinweis ?? "Der Link ist unterwegs, falls die Adresse hinterlegt ist.");
    setStand("fertig");
  }

  if (stand === "fertig") {
    return (
      <p className="hinweis">{hinweis}</p>
    );
  }

  return (
    <form onSubmit={absenden}>
      <label htmlFor="email">
        E-Mail-Adresse aus dem Mietvertrag
        <input
          id="email"
          className="feld"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <button type="submit" disabled={stand === "laeuft"}>
        {stand === "laeuft" ? "Einen Moment …" : "Link anfordern"}
      </button>
    </form>
  );
}
