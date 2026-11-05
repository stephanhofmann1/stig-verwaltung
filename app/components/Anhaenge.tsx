"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Anhänge an einem Entwurf: sehen, anhängen, entfernen.
 *
 * Der Anlass steht in db/032. Kurz: Eine Schadensmeldung an den
 * Fensterbauer brauchte sieben Fotos, und das Portal konnte keine
 * Anhänge.
 *
 * DREI ENTSCHEIDUNGEN
 *
 *   1. Die Paketgröße steht sichtbar da, nicht erst in der Fehlermeldung.
 *      Wer sieben Bilder vom Telefon anhängt, ist schnell bei 20 MB, und
 *      es ist ein Unterschied, ob man das beim fünften Bild sieht oder
 *      beim Klick auf "Senden". Angezeigt wird die Größe IN DER MAIL --
 *      also kodiert, nicht die Summe der Dateigrößen (lib/anhaenge.ts).
 *      Die kleinere Zahl wäre die freundlichere und die falsche.
 *
 *   2. HEIC wird gewarnt, nicht umgewandelt. Die Kamera des iPhones
 *      liefert HEIC, und Outlook unter Windows zeigt davon nichts. Eine
 *      stille Umwandlung wäre bequemer, aber dann weiß am Ende niemand,
 *      welches Bild der Empfänger gesehen hat -- bei einer
 *      Schadensmeldung an eine Versicherung ist das die schlechtere
 *      Eigenschaft.
 *
 *   3. Entfernen fragt nicht nach. Ein Anhang an einem Entwurf ist
 *      nichts, was verloren gehen kann: Die Datei liegt noch in der
 *      Ablage, solange eine andere Zeile auf sie zeigt, und neu
 *      hochladen dauert zwei Sekunden. Rückfragen gehören dorthin, wo
 *      etwas das Haus verlässt.
 */

export interface AnhangAnzeige {
  id: string;
  dateiname: string;
  mime_typ: string | null;
  richtung: "eingehend" | "ausgehend";
  groesse_bytes: number;
}

interface Props {
  /** Die Kennung der Nachricht (nicht des Anhangs). */
  nachrichtId: string;
  /** Serverseitig geladen; ohne Angabe holt die Karte sie selbst. */
  anfang?: AnhangAnzeige[];
  /** Am Entwurf: anhängen und entfernen. In der Akte: nur lesen. */
  aenderbar: boolean;
  blockiert?: boolean;
}

/** Die Kodierung wächst um ein Drittel, dazu CRLF je 76 Zeichen. */
function mimeGroesse(bytes: number): number {
  if (bytes <= 0) return 0;
  const b64 = 4 * Math.ceil(bytes / 3);
  return b64 + Math.ceil(b64 / 76) * 2;
}

function lesbar(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const GRENZE = 20 * 1024 * 1024;

export function Anhaenge(p: Props) {
  const [liste, setListe] = useState<AnhangAnzeige[] | null>(p.anfang ?? null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const feld = useRef<HTMLInputElement>(null);

  async function lade() {
    const r = await fetch(`/api/nachricht/${p.nachrichtId}/anhang`, {
      cache: "no-store",
    });
    if (!r.ok) return;
    const j = (await r.json()) as { anhaenge: AnhangAnzeige[] };
    setListe(j.anhaenge);
  }

  useEffect(() => {
    if (p.anfang === undefined) void lade();
    // Einmal beim Aufbau. Die Liste ändert sich nur durch die Knöpfe hier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hochladen(dateien: FileList | null) {
    if (!dateien || dateien.length === 0) return;
    setBusy(true);
    setFehler(null);

    // Nacheinander, nicht parallel. Die Paketprüfung auf dem Server
    // rechnet gegen das, was schon hängt -- bei gleichzeitigen Anfragen
    // sähe jede von ihnen den Stand vor den anderen, und in der Summe
    // käme ein Paket über der Grenze heraus, das jede einzelne Prüfung
    // durchgelassen hat.
    for (const datei of Array.from(dateien)) {
      const form = new FormData();
      form.append("datei", datei);
      const r = await fetch(`/api/nachricht/${p.nachrichtId}/anhang`, {
        method: "POST",
        body: form,
      });
      const j = (await r.json().catch(() => ({}))) as {
        fehler?: string;
        doppelt?: boolean;
      };
      if (!r.ok) {
        setFehler(`${datei.name}: ${j.fehler ?? `Fehler ${r.status}`}`);
        break;
      }
    }

    if (feld.current) feld.current.value = "";
    await lade();
    setBusy(false);
  }

  async function entfernen(id: string) {
    setBusy(true);
    setFehler(null);
    const r = await fetch(`/api/anhang/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { fehler?: string };
      setFehler(j.fehler ?? `Fehler ${r.status}`);
    }
    await lade();
    setBusy(false);
  }

  if (liste === null) return null;
  if (liste.length === 0 && !p.aenderbar) return null;

  const kodiert = liste.reduce(
    (s, a) => s + mimeGroesse(Number(a.groesse_bytes)),
    0,
  );
  const heic = liste.some((a) => a.mime_typ === "image/heic");
  const eng = kodiert > GRENZE * 0.8;

  return (
    <div className="anhaenge">
      <p className="anhaenge-kopf">
        <span>
          {liste.length === 0
            ? "Keine Anhänge"
            : `${liste.length} ${liste.length === 1 ? "Anhang" : "Anhänge"}`}
        </span>
        {liste.length > 0 && (
          <span className="anhaenge-mass" data-eng={eng ? "ja" : undefined}>
            {lesbar(kodiert)} in der Mail
          </span>
        )}
      </p>

      <ul className="anhaenge-liste">
        {liste.map((a) => (
          <li key={a.id}>
            <a href={`/api/anhang/${a.id}`} rel="noreferrer">
              {a.dateiname}
            </a>
            <span className="anhaenge-groesse">
              {lesbar(Number(a.groesse_bytes))}
            </span>
            {p.aenderbar && a.richtung === "ausgehend" && (
              <button
                type="button"
                data-art="still"
                onClick={() => void entfernen(a.id)}
                disabled={busy || p.blockiert}
                aria-label={`${a.dateiname} entfernen`}
              >
                Entfernen
              </button>
            )}
          </li>
        ))}
      </ul>

      {heic && (
        <p className="anhaenge-warnung">
          HEIC dabei. Outlook unter Windows zeigt dieses Format nicht an — wer
          die Bilder dort öffnet, sieht nichts. Als JPEG exportieren, wenn der
          Empfänger sie ansehen soll.
        </p>
      )}

      {p.aenderbar && (
        <label className="anhaenge-feld">
          <span>{busy ? "Lädt…" : "Datei anhängen"}</span>
          <input
            ref={feld}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.heic,application/pdf,image/png,image/jpeg,image/heic"
            disabled={busy || p.blockiert}
            onChange={(e) => void hochladen(e.target.files)}
          />
        </label>
      )}

      {fehler && (
        <p className="rueckmeldung" data-art="fehler">
          {fehler}
        </p>
      )}
    </div>
  );
}
