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
      <p className="hinweis">
        Angekommen{referenz ? ` als Vorgang ${referenz}` : ""}. Wir melden uns.
      </p>
    );
  }

  return (
    <form onSubmit={absenden}>
      {/* Das Feld steht im label, nicht daneben: so traegt das label den
          Abstand zur naechsten Gruppe, und beides gehoert auch fuer einen
          Screenreader zusammen. Breite und Rand kommen aus .feld. */}
      <label htmlFor="betreff">
        Worum geht es?
        <input
          id="betreff"
          className="feld"
          value={betreff}
          onChange={(e) => setBetreff(e.target.value)}
          placeholder="z. B. Heizung wird nicht warm"
        />
      </label>
      <label htmlFor="text">
        Beschreibung
        <textarea
          id="text"
          className="feld"
          required
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {fehler && (
        <p className="rueckmeldung" data-art="fehler">
          {fehler}
        </p>
      )}
      <button type="submit" disabled={stand === "laeuft"}>
        {stand === "laeuft" ? "Wird gesendet …" : "Melden"}
      </button>
    </form>
  );
}
