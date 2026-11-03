"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/*
 * Das Stilobjekt `feld` ist ersatzlos weg. Es setzte ein festes Weiss als
 * Feldhintergrund -- im Dunkelmodus weisse Kaesten mit weisser Schrift --
 * und ueberschrieb den Feldrand mit der Haarlinie. Abschnitt 12 von
 * globals.css gestaltet die Felder vollstaendig, .feld gibt die Breite.
 */

export function AnmeldeFormular({ weiter }: { weiter: string }) {
  const router = useRouter();
  const [benutzer, setBenutzer] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      const r = await fetch("/api/anmelden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benutzer, passwort }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFehler(d.fehler ?? "Anmeldung fehlgeschlagen.");
        return;
      }
      router.replace(weiter);
      router.refresh();
    } catch {
      setFehler("Der Server ist nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={absenden}>
      <label htmlFor="benutzer">
        Benutzer
        <input
          id="benutzer"
          className="feld"
          value={benutzer}
          onChange={(e) => setBenutzer(e.target.value)}
          autoComplete="username"
          autoFocus
        />
      </label>
      <label htmlFor="passwort">
        Passwort
        <input
          id="passwort"
          className="feld"
          type="password"
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <div className="knopfreihe">
        <button type="submit" disabled={busy}>
          {busy ? "Prüft…" : "Anmelden"}
        </button>
        {fehler && (
          <span className="rueckmeldung" data-art="fehler">
            {fehler}
          </span>
        )}
      </div>
    </form>
  );
}
