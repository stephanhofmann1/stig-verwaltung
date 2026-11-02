"use client";

import { useState } from "react";

/**
 * Formular für einen neuen FinTS-Zugang.
 *
 * Die PIN wird abgeschickt und sofort auf dem Server verschlüsselt. Sie
 * steht in keinem Log, in keiner Antwort und wird nach dem Absenden aus
 * dem Formular entfernt -- damit sie nicht im Browser liegen bleibt, wenn
 * der Rechner unbeaufsichtigt ist.
 */
export function BankNeu({ konten }: { konten: string[] }) {
  const [offen, setOffen] = useState(false);
  const [stand, setStand] = useState<"bereit" | "laeuft">("bereit");
  const [meldung, setMeldung] = useState("");
  const [fehler, setFehler] = useState("");

  async function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setStand("laeuft");
    setFehler("");
    setMeldung("");
    const r = await fetch("/api/bank", {
      method: "POST",
      body: new FormData(form),
    });
    const d = (await r.json().catch(() => ({}))) as
      { ok?: boolean; bezeichnung?: string; fehler?: string };
    setStand("bereit");
    if (d.ok) {
      // Die PIN aus dem Formular nehmen, nicht nur die Ansicht umschalten.
      form.reset();
      setMeldung(
        `Zugang "${d.bezeichnung}" gespeichert. Jetzt einmal abrufen — ` +
        "beim ersten Mal verlangt die Bank eine TAN.",
      );
      setOffen(false);
      // Damit die Liste den neuen Zugang zeigt.
      setTimeout(() => window.location.reload(), 1200);
    } else {
      setFehler(d.fehler ?? "Das hat nicht geklappt.");
    }
  }

  if (!offen) {
    return (
      <>
        {meldung && <p style={{ color: "#1b6b3a" }}>{meldung}</p>}
        <button onClick={() => setOffen(true)}>Bankzugang einrichten</button>
      </>
    );
  }

  const feld = { display: "block", width: "100%", marginBottom: "0.75rem" };

  return (
    <form onSubmit={absenden} style={{ maxWidth: "32rem" }}>
      <label>Bezeichnung
        <input name="bezeichnung" required placeholder="Sparkasse Wetzlar" style={feld} />
      </label>
      <label>Konto in der Verwaltung
        <select name="konto" required style={feld} defaultValue="">
          <option value="" disabled>bitte wählen</option>
          {konten.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label>Bankleitzahl
        <input name="bank_id" required placeholder="51550035" style={feld} />
      </label>
      <label>FinTS-Adresse der Bank
        <input name="url" required type="url" placeholder="https://..." style={feld} />
        <span className="hinweis">
          Steht auf der Website der Bank unter HBCI/FinTS. Muss mit https
          beginnen — ohne Verschlüsselung wird der Zugang nicht angenommen.
        </span>
      </label>
      <label>Anmeldename im Onlinebanking
        <input name="benutzer" required style={feld} />
      </label>
      <label>Kundennummer, falls abweichend
        <input name="kunden_id" style={feld} />
      </label>
      <label>IBAN des Kontos, falls der Zugang mehrere sieht
        <input name="konto_iban" placeholder="DE..." style={feld} />
      </label>
      <label>PIN
        <input name="pin" required type="password" autoComplete="off" style={feld} />
        <span className="hinweis">
          Wird sofort verschlüsselt gespeichert und nirgends protokolliert.
          Sie schützt damit Datenbankabzüge und Sicherungen — nicht gegen
          jemanden mit Vollzugriff auf den Server.
        </span>
      </label>

      {fehler && <p style={{ color: "#b3261e" }}>{fehler}</p>}

      <button type="submit" disabled={stand === "laeuft"}>
        {stand === "laeuft" ? "speichert …" : "Zugang speichern"}
      </button>{" "}
      <button type="button" data-art="still" onClick={() => setOffen(false)}>
        Abbrechen
      </button>
    </form>
  );
}
