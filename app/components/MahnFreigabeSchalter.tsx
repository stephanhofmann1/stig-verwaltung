"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Die Freigabe des Mahnwesens als Schalter.
 *
 * Bis hierhin war die Freigabe ein INSERT von Hand in `mahnwesen_freigabe`.
 * Die Sperre selbst ist richtig und bleibt (db/024: keine Zeile = gesperrt);
 * falsch war nur, dass die Entscheidung an der einen Stelle nicht zu
 * treffen war, an der die Grundlage dafür steht.
 *
 * Zwei Dinge macht der Schalter sichtbar:
 *   - Freigeben geht erst, wenn jede Zeile der Bereitschaftsliste grün ist.
 *     Steht etwas offen, ist der Knopf gesperrt und daneben steht, was
 *     fehlt -- nicht nur "gesperrt".
 *   - Die Notiz ist Pflicht. Woran die Freigabe hing, gehört zur
 *     Entscheidung; in sechs Wochen weiß das sonst niemand mehr.
 *
 * Zurücknehmen löscht die Zeile (db/024 erlaubt kein UPDATE, das ist
 * Absicht). Der Grund dafür wandert ins Protokoll, damit die Rücknahme
 * nicht spurlos bleibt.
 */

export interface FreigabeStand {
  freigegeben_am: string;
  freigegeben_von: string;
  notiz: string | null;
}

interface Props {
  freigabe: FreigabeStand | null;
  /** Punkte der Bereitschaftsliste, die noch offen sind. */
  fehlt: string[];
  /** Darf der angemeldete Zugang überhaupt entscheiden? */
  darfEntscheiden: boolean;
  /** Warum nicht -- aus lib/mahnablauf.ts, im Wortlaut. */
  grundWennNicht: string;
}

const tagDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function MahnFreigabeSchalter(p: Props) {
  const router = useRouter();
  const [notiz, setNotiz] = useState("");
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenZuruecknehmen, setOffenZuruecknehmen] = useState(false);

  const gesperrt = p.freigabe === null;
  const bereit = p.fehlt.length === 0;
  const notizReicht = notiz.trim().length >= 5;

  async function schicke(koerper: Record<string, string>) {
    setLaeuft(true);
    setFehler(null);
    try {
      const r = await fetch("/api/mahnwesen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(koerper),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        fehler?: string;
      };
      if (!r.ok || !d.ok) {
        setFehler(d.fehler ?? "Das hat nicht geklappt.");
        return;
      }
      setNotiz("");
      setGrund("");
      setOffenZuruecknehmen(false);
      router.refresh();
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="karte">
      <h2 className="karte-titel">Freigabe des Mahnwesens</h2>

      {gesperrt ? (
        <div className="meldung" data-art="warnung">
          <strong>Gesperrt — es entsteht kein Schreiben</strong>
          Solange keine Freigabe vorliegt, wird kein Entwurf angelegt, auch
          keiner, der nur in der Freigabe liegen würde. Die Sperre steht in
          der Datenbank und nicht nur in der Absprache: Auch ein nächtlicher
          Lauf kommt an ihr nicht vorbei.
        </div>
      ) : (
        <div className="meldung" data-art="gut">
          <strong>Freigegeben</strong>
          Erteilt von {p.freigabe!.freigegeben_von} am{" "}
          {tagDe(p.freigabe!.freigegeben_am)}
          {p.freigabe!.notiz ? ` — ${p.freigabe!.notiz}` : ""}. Versendet wird
          trotzdem nichts von allein: Jedes Schreiben wird einzeln entworfen
          und einzeln freigegeben.
        </div>
      )}

      {!p.darfEntscheiden && <p className="hinweis">{p.grundWennNicht}</p>}

      {p.darfEntscheiden && gesperrt && (
        <>
          <label className="feld">
            Notiz zur Freigabe (Pflicht)
            <input
              type="text"
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              placeholder="z. B. Abgleich bis 10/2026 geprüft, keine offenen Eingänge"
              disabled={!bereit || laeuft}
            />
          </label>
          <div className="knopfreihe">
            <button
              onClick={() => schicke({ aktion: "freigeben", notiz })}
              disabled={!bereit || !notizReicht || laeuft}
            >
              {laeuft ? "gibt frei …" : "Mahnwesen freigeben"}
            </button>
            {!bereit && (
              <span className="rueckmeldung" data-art="fehler">
                Gesperrt, es fehlt noch: {p.fehlt.join("; ")}.
              </span>
            )}
            {bereit && !notizReicht && (
              <span className="rueckmeldung">
                Die Notiz fehlt noch — ein halber Satz genügt.
              </span>
            )}
          </div>
        </>
      )}

      {p.darfEntscheiden && !gesperrt && (
        <div className="knopfreihe">
          {!offenZuruecknehmen ? (
            <button data-art="still" onClick={() => setOffenZuruecknehmen(true)}>
              Freigabe zurücknehmen
            </button>
          ) : (
            <>
              <input
                type="text"
                value={grund}
                onChange={(e) => setGrund(e.target.value)}
                placeholder="Grund der Rücknahme (Pflicht)"
                disabled={laeuft}
              />
              <button
                onClick={() => schicke({ aktion: "sperren", grund })}
                disabled={grund.trim().length < 5 || laeuft}
              >
                {laeuft ? "sperrt …" : "Wieder sperren"}
              </button>
              <button
                data-art="still"
                onClick={() => setOffenZuruecknehmen(false)}
                disabled={laeuft}
              >
                Abbrechen
              </button>
            </>
          )}
        </div>
      )}

      {fehler && (
        <div className="meldung" data-art="fehler">
          <strong>Nicht geschaltet</strong>
          {fehler}
        </div>
      )}
    </section>
  );
}
