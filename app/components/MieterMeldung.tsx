"use client";

import { useState } from "react";

export function MieterMeldung() {
  const [betreff, setBetreff] = useState("");
  const [text, setText] = useState("");
  const [stand, setStand] = useState<"bereit" | "laeuft" | "fertig">("bereit");
  const [fehler, setFehler] = useState("");
  const [referenz, setReferenz] = useState<number | null>(null);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setStand("laeuft");
    setFehler("");
    const r = await fetch("/api/mieter/meldung", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ betreff, text }),
    });
    const d = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      referenz?: number;
      fehler?: string;
    };
    if (d.ok) {
      setReferenz(d.referenz ?? null);
      setStand("fertig");
    } else {
      setFehler(d.fehler ?? "Das hat nicht geklappt.");
      setStand("bereit");
    }
  }

  if (stand === "fertig") {
    return (
      <p className="hinweis" style={{ lineHeight: 1.6 }}>
        Angekommen{referenz ? ` als Vorgang ${referenz}` : ""}. Wir melden uns.
      </p>
    );
  }

  return (
    <form onSubmit={absenden}>
      <label htmlFor="betreff" style={{ display: "block", marginBottom: "0.35rem" }}>
        Worum geht es?
      </label>
      <input
        id="betreff"
        value={betreff}
        onChange={(e) => setBetreff(e.target.value)}
        placeholder="z. B. Heizung wird nicht warm"
        style={{ width: "100%", marginBottom: "0.75rem" }}
      />
      <label htmlFor="text" style={{ display: "block", marginBottom: "0.35rem" }}>
        Beschreibung
      </label>
      <textarea
        id="text"
        required
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", marginBottom: "0.75rem" }}
      />
      {fehler && (
        <p className="hinweis" style={{ color: "#b00" }}>
          {fehler}
        </p>
      )}
      <button type="submit" disabled={stand === "laeuft"}>
        {stand === "laeuft" ? "Wird gesendet …" : "Melden"}
      </button>
    </form>
  );
}
