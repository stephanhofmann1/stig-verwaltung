"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Der Mandantenumschalter in der Kopfzeile.
 *
 * WARUM ER IN DER MARKE SITZT
 *
 * Die Kopfzeile sagte bisher "STIG Verwaltung" -- auf jeder Seite
 * dasselbe, also eine Dekoration. Mit zwei Mandanten ist das die
 * wichtigste Angabe der ganzen Oberfläche: In welchem arbeite ich
 * gerade? Wer das verwechselt, legt einen privaten Beleg in die
 * Buchhaltung der eGbR. Also steht dort jetzt der Name des aktiven
 * Mandanten, und der Wechsel geschieht an derselben Stelle.
 *
 * WARUM OHNE ZWEITEN MANDANTEN NICHTS ANDERS AUSSIEHT
 *
 * Wer nur einen hat, bekommt reinen Text wie vorher -- kein Menü, kein
 * Pfeil, kein Hinweis auf eine Möglichkeit, die er nicht braucht. Ein
 * Umschalter mit einem Eintrag ist eine Frage ohne Antwort.
 */
export interface MandantAngabe {
  mandant: string;
  name: string;
  kuerzel: string;
}

export function MandantWahl({
  aktiv,
  zugaenge,
}: {
  aktiv: MandantAngabe | null;
  zugaenge: MandantAngabe[];
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Nicht angemeldet, oder nur ein Mandant: die Marke wie bisher.
  if (!aktiv || zugaenge.length < 2) {
    return (
      <div className="marke">
        {aktiv ? aktiv.name : (
          <>
            STIG <span>Verwaltung</span>
          </>
        )}
      </div>
    );
  }

  async function wechsle(ziel: string) {
    if (ziel === aktiv!.mandant) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const r = await fetch("/api/mandant/wechseln", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mandant: ziel }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Der Wechsel hat nicht geklappt.");
        setLaeuft(false);
        return;
      }
      // Alles neu laden: Jede Seite zeigt Daten des alten Mandanten, und
      // die Zwischenspeicher des Routers kennen den Wechsel nicht.
      // router.refresh() allein genügt dafür nicht.
      window.location.assign("/cockpit");
    } catch {
      setFehler("Der Wechsel hat nicht geklappt.");
      setLaeuft(false);
    }
  }

  return (
    <div className="marke mandantwahl">
      <label className="nurvorleser" htmlFor="mandantwahl">
        Mandant
      </label>
      <select
        id="mandantwahl"
        value={aktiv.mandant}
        disabled={laeuft}
        onChange={(e) => void wechsle(e.target.value)}
      >
        {zugaenge.map((z) => (
          <option key={z.mandant} value={z.mandant}>
            {z.name}
          </option>
        ))}
      </select>
      {fehler && <span className="mandantwahl-fehler">{fehler}</span>}
    </div>
  );
}
