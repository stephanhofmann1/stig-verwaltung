"use client";

import { useState } from "react";

/**
 * Formular fuer ein neues Konto der Verwaltung.
 *
 * Die IBAN wird auf die letzten vier Stellen gekuerzt, bevor sie gespeichert
 * wird -- das sagt der Hinweis im Formular auch, damit niemand glaubt, die
 * ganze Nummer sei abgelegt.
 */
export function KontoNeu({ objekte }: { objekte: { id: string; name: string }[] }) {
  const [offen, setOffen] = useState(false);
  const [stand, setStand] = useState<"bereit" | "laeuft">("bereit");
  const [fehler, setFehler] = useState("");

  async function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setStand("laeuft");
    setFehler("");
    const r = await fetch("/api/konten", { method: "POST", body: new FormData(form) });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; fehler?: string };
    setStand("bereit");
    if (d.ok) {
      window.location.reload();
    } else {
      setFehler(d.fehler ?? "Das hat nicht geklappt.");
    }
  }

  if (!offen) {
    return <button onClick={() => setOffen(true)}>Konto anlegen</button>;
  }

  const feld = { display: "block", width: "100%", marginBottom: "0.75rem" };

  return (
    <form onSubmit={absenden} style={{ maxWidth: "32rem" }}>
      <label>Bezeichnung
        <input name="bezeichnung" required placeholder="Sparkasse Gießen" style={feld} />
        <span className="hinweis">
          Unter diesem Namen sucht der Import sein Konto. Am besten so, wie
          du das Konto selbst nennst.
        </span>
      </label>
      <label>Art
        <select name="art" defaultValue="bank" style={feld}>
          <option value="bank">Bankkonto</option>
          <option value="barkasse">Barkasse</option>
        </select>
      </label>
      <label>Gehört zu Objekt (optional)
        <select name="objekt_id" defaultValue="" style={feld}>
          <option value="">— keinem bestimmten —</option>
          {objekte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <label>IBAN (optional)
        <input name="iban_kurz" placeholder="DE…" style={feld} />
        <span className="hinweis">
          Es werden nur die letzten vier Stellen gespeichert, zum
          Wiedererkennen in der Liste. Die ganze IBAN einfügen ist in
          Ordnung — sie wird gekürzt, bevor sie in die Datenbank geht.
        </span>
      </label>
      <label>Notiz (optional)
        <input name="notizen" style={feld} />
      </label>

      {fehler && <p style={{ color: "#b3261e" }}>{fehler}</p>}

      <button type="submit" disabled={stand === "laeuft"}>
        {stand === "laeuft" ? "speichert …" : "Konto anlegen"}
      </button>{" "}
      <button type="button" data-art="still" onClick={() => setOffen(false)}>
        Abbrechen
      </button>
    </form>
  );
}
