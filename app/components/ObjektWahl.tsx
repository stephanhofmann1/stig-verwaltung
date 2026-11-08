"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ALLE, type ObjektAngabe } from "@/lib/objektwahl";

/**
 * Der Objektumschalter in der Kopfzeile.
 *
 * WARUM ER NEBEN DEM MANDANTEN STEHT
 *
 * Die beiden beantworten dieselbe Frage auf zwei Ebenen: Wessen Zahlen
 * sehe ich, und von welchem Haus? Stephan am 08.11.2026: "Die Gesamtschau
 * interessiert in den wenigsten Faellen. Ich behandle die Objekte gerne
 * separat." Drei Haeuser in einem Mandanten -- Augartenstrasse,
 * Welserstrasse, Westanlage -- und bis heute ein einziges Cockpit, das
 * sie zusammenrechnete.
 *
 * WARUM DER UNTERSCHIED ZUM MANDANTENWECHSEL SICHTBAR BLEIBT
 *
 * Der Mandantenwechsel stellt die Sitzung neu aus und laedt die Seite
 * vollstaendig neu -- er aendert, was jemand sehen darf. Hier genuegt
 * router.refresh(): Es aendert sich nur der Ausschnitt, nicht das Recht.
 * Dass der eine hart neu laedt und der andere nicht, ist kein Versehen,
 * sondern der Unterschied selbst.
 *
 * WARUM OHNE ZWEITES OBJEKT NICHTS ERSCHEINT
 *
 * Wie beim Mandanten: Ein Umschalter mit einem Eintrag ist eine Frage
 * ohne Antwort. Wer ein Haus hat, soll nicht jedes Mal lesen, dass er
 * zwischen "allen" und diesem einen waehlen kann.
 */
export function ObjektWahl({
  objekte,
  gewaehlt,
}: {
  objekte: ObjektAngabe[];
  gewaehlt: ObjektAngabe | null;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (objekte.length < 2) return null;

  async function stelleUm(ziel: string) {
    setLaeuft(true);
    setFehler(null);
    try {
      const r = await fetch("/api/objekt/sicht", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objekt: ziel }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Das Umstellen hat nicht geklappt.");
        setLaeuft(false);
        return;
      }
      // Die Seite bleibt, die Zahlen wechseln. Kein window.location:
      // Wer auf den Rueckstaenden steht, will dort bleiben und sie fuer
      // das andere Haus sehen -- nicht wieder im Cockpit landen.
      router.refresh();
      setLaeuft(false);
    } catch {
      setFehler("Das Umstellen hat nicht geklappt.");
      setLaeuft(false);
    }
  }

  return (
    <div className="objektwahl">
      <label className="nurvorleser" htmlFor="objektwahl">
        Objekt
      </label>
      <select
        id="objektwahl"
        value={gewaehlt?.id ?? ALLE}
        disabled={laeuft}
        onChange={(e) => void stelleUm(e.target.value)}
      >
        {/* Die Gesamtschau steht oben und heisst, was sie ist. "Alle"
            allein liesse offen: alle Objekte oder alle Mandanten? */}
        <option value={ALLE}>Alle Objekte</option>
        {objekte.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {fehler && <span className="objektwahl-fehler">{fehler}</span>}
    </div>
  );
}
