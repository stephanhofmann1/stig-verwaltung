"use client";

import { useState } from "react";

/**
 * Was die Maschine zugeordnet hat -- mit Begründung und Rückweg.
 *
 * WARUM DIESE LISTE EXISTIERT
 *
 * Der Abgleich schreibt sichere Treffer selbsttätig in die Bücher. Die
 * Begründung dafür stand bisher nur in der Datenbank. Am 06.11.2026
 * ordnete eine neue Regel 28 Bewegungen auf einen Schlag zu -- richtig,
 * wie sich zeigte, aber nachprüfen ließ sich das nur mit einer
 * Datenbankabfrage.
 *
 * Eine Maschine, die ins Hauptbuch schreibt, muss zeigen, was sie getan
 * hat und warum. Und sie muss sich korrigieren lassen: Ohne den Knopf
 * „Lösen" wäre jede Regelverbesserung ein Risiko, das man lieber nicht
 * eingeht.
 */
export interface Zuordnung {
  id: string;
  betrag: string;
  sicherheit: string;
  begruendung: string | null;
  buchungstag: string;
  absender: string | null;
  verwendungszweck: string | null;
  beleg_id: string;
  dateiname: string | null;
  aussteller: string | null;
  belegnummer: string | null;
  belegdatum: string | null;
}

const euro = (w: string | number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Math.abs(Number(w)),
  );

const tag = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE") : "ohne Datum";

export function Zuordnungen({ anfang }: { anfang: Zuordnung[] }) {
  const [liste, setListe] = useState(anfang);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  if (liste.length === 0) {
    return (
      <p className="hinweis">
        Noch keine Zuordnung. Was der Abgleich festschreibt, erscheint hier mit
        Begründung — und lässt sich hier auch wieder lösen.
      </p>
    );
  }

  async function loese(id: string) {
    setLaeuft(id);
    setFehler(null);
    try {
      const r = await fetch("/api/belege/zuordnungen", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Das Lösen hat nicht geklappt.");
        return;
      }
      setListe((l) => l.filter((z) => z.id !== id));
    } catch {
      setFehler("Das Lösen hat nicht geklappt.");
    } finally {
      setLaeuft(null);
    }
  }

  return (
    <>
      {fehler && <p className="hinweis">{fehler}</p>}
      <div className="register">
        {liste.map((z) => (
          <div className="posten" key={z.id}>
            <div className="posten-kopf">
              <span className="ziffern">{euro(z.betrag)}</span>
              <span className="still">{tag(z.buchungstag)}</span>
              <span className={z.sicherheit === "sicher" ? "marker" : "marker still"}>
                {z.sicherheit}
              </span>
              <button
                type="button"
                className="knopf"
                disabled={laeuft === z.id}
                onClick={() => void loese(z.id)}
              >
                {laeuft === z.id ? "löst …" : "Lösen"}
              </button>
            </div>
            <div className="still">
              {z.absender ?? "ohne Absender"} · {(z.verwendungszweck ?? "").slice(0, 90)}
            </div>
            <div>
              <a className="posten" href={`/api/belege/${z.beleg_id}/datei`}>
                {z.aussteller ?? "Unbekannt"} ·{" "}
                {z.belegnummer ?? z.dateiname ?? "ohne Nummer"} · {tag(z.belegdatum)}
              </a>
            </div>
            {z.begruendung && <div className="hinweis">{z.begruendung}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
