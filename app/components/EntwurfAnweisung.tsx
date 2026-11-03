"use client";

import { useState } from "react";
import type { WeisungAnzeige } from "@/components/Herkunft";

/**
 * Anweisung geben und den Entwurf neu erzeugen lassen.
 *
 * DAS KERNSTUECK DER AENDERUNG VOM 03.11.2026
 *
 * Vorher konnte der Mensch an einem Entwurf genau zwei Dinge tun:
 * freigeben oder verwerfen. Den Text von Hand umschreiben ging auch, aber
 * das ist keine Steuerung der Automatik, sondern ihr Ersatz. Fuer ein
 * Postfach ist beides zu wenig: Der Agent wird Fehler machen, und man
 * muss ihm sagen koennen, dass es kuerzer sein soll, dass er nach dem
 * Zaehlerstand fragen soll, dass dieser Mieter sonst puenktlich zahlt.
 *
 * VIER ENTSCHEIDUNGEN
 *
 *   1. Der alte Entwurf geht nicht verloren. Jede Nacherzeugung legt eine
 *      neue Fassung an (db/031: entwurf_fassung), die alten bleiben
 *      stehen und sind hier aufklappbar -- mit der Anweisung, die zu
 *      jeder gefuehrt hat. Wer eine Verschlechterung bemerkt, geht
 *      zurueck; bei einer Mahnung bleibt nachvollziehbar, welcher Text
 *      wann entstand.
 *
 *   2. Zurueckgehen loescht nichts. Es fuegt den alten Text als neue
 *      Fassung an. Dass jemand zurueckgegangen ist, gehoert zur
 *      Geschichte dieses Textes.
 *
 *   3. Es entsteht IMMER nur ein Entwurf. Dieser Knopf ruft PUT
 *      /api/entwurf/[id]; der Versand haengt an POST. Zwei Methoden und
 *      kein Schalter -- der Unterschied zwischen "neu formulieren" und
 *      "senden" darf nicht an einem Wahrheitswert haengen.
 *
 *   4. Scheitert die Nacherzeugung, bleibt der bisherige Text stehen und
 *      hier steht, dass nichts erzeugt wurde. Ein leeres Feld nach einem
 *      Fehlschlag waere der schlimmere Ausgang: Der Mensch haette
 *      geklickt, seinen Text verloren und nicht erfahren, warum.
 */

export interface FassungAnzeige {
  fassung: number;
  koerper_text: string;
  anweisung: string | null;
  quelle: "regel" | "modell" | "mensch";
  modell: string | null;
  wer: string | null;
}

const QUELLE_LABEL: Record<FassungAnzeige["quelle"], string> = {
  regel: "Textbaustein",
  modell: "Sprachmodell",
  mensch: "von Hand",
};

interface Props {
  /** Die Kennung des Entwurfs (nachricht.id). */
  id: string;
  fassungen: FassungAnzeige[];
  weisungen: WeisungAnzeige[];
  /** Wird mit dem neuen Text und der neuen Historie gerufen. */
  uebernehmen: (text: string, fassungen: FassungAnzeige[]) => void;
  /** Gesperrt, solange die Karte anderweitig arbeitet. */
  blockiert?: boolean;
}

type Meldung = { art: "gut" | "warn" | "fehler"; text: string };

export function EntwurfAnweisung(p: Props) {
  const [anweisung, setAnweisung] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  const gesperrt = laeuft || p.blockiert === true;
  const reicht = anweisung.trim().length >= 3;

  async function schicke(koerper: Record<string, unknown>, erfolg: string) {
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await fetch(`/api/entwurf/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(koerper),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        fehler?: string;
        koerper_text?: string;
        fassungen?: FassungAnzeige[];
      };

      if (!r.ok || !d.ok) {
        // Der bisherige Entwurf bleibt unberuehrt -- es wird hier nichts
        // uebernommen. Genau das muss die Meldung sagen.
        setMeldung({
          art: "fehler",
          text:
            (d.fehler ?? "Das hat nicht geklappt.") +
            " Es wurde nichts erzeugt — der bisherige Entwurf steht unverändert.",
        });
        return;
      }

      if (typeof d.koerper_text === "string") {
        p.uebernehmen(d.koerper_text, d.fassungen ?? p.fassungen);
      }
      setAnweisung("");
      setMeldung({ art: "gut", text: erfolg });
    } catch (e) {
      setMeldung({
        art: "fehler",
        text:
          `${(e as Error).message}. Es wurde nichts erzeugt — der bisherige ` +
          "Entwurf steht unverändert.",
      });
    } finally {
      setLaeuft(false);
    }
  }

  const fassungen = [...p.fassungen].sort((a, b) => b.fassung - a.fassung);
  const jetzt = fassungen[0]?.fassung ?? 1;

  return (
    <div className="abschnitt">
      <label className="feld">
        Was soll anders werden?
        <textarea
          value={anweisung}
          onChange={(e) => setAnweisung(e.target.value)}
          rows={2}
          spellCheck
          disabled={gesperrt}
          placeholder="kürzer · frag nach dem Zählerstand · freundlicher, der zahlt sonst pünktlich · auf Englisch"
        />
      </label>

      <div className="knopfreihe">
        <button
          onClick={() =>
            schicke(
              { anweisung },
              `Neu erzeugt. Der alte Text steht als Fassung ${jetzt} in der Historie.`,
            )
          }
          disabled={gesperrt || !reicht}
        >
          {laeuft ? "Erzeugt…" : "Neu erzeugen"}
        </button>
        {!reicht && !meldung && (
          <span className="rueckmeldung">
            Schreib in eigenen Worten, was anders werden soll.
          </span>
        )}
        {p.weisungen.length > 0 && !meldung && (
          <span className="rueckmeldung" data-art="info">
            {p.weisungen.length} dauerhafte Weisung
            {p.weisungen.length === 1 ? "" : "en"} wirkt mit.
          </span>
        )}
        {meldung && (
          <span
            className="rueckmeldung"
            data-art={
              meldung.art === "gut"
                ? "gut"
                : meldung.art === "warn"
                  ? "warn"
                  : "fehler"
            }
          >
            {meldung.text}
          </span>
        )}
      </div>

      <p className="erklaerung">
        Die Anweisung geht zusammen mit dem bisherigen Entwurf, dem
        Mailverlauf und den dauerhaften Weisungen an das Sprachmodell. Es
        entsteht dabei immer nur ein Entwurf — gesendet wird nichts, auch
        nicht, wenn es in der Anweisung steht.
      </p>

      {fassungen.length > 1 && (
        <details className="erklaerung">
          <summary>
            {fassungen.length} Fassungen — ältere ansehen und zurückgehen
          </summary>
          <div className="register">
            {fassungen.map((f) => (
              <div className="posten" data-still="ja" key={f.fassung}>
                <span className="nummer ziffern">
                  {String(f.fassung).padStart(2, "0")}
                </span>
                <span className="betreff">
                  {f.anweisung ?? "Von der Automatik angelegt"}
                </span>
                <span className="zeit">
                  {f.fassung === jetzt ? "gilt jetzt" : ""}
                </span>
                <span className="unterzeile">
                  <span>
                    {QUELLE_LABEL[f.quelle]}
                    {f.modell ? ` (${f.modell})` : ""}
                  </span>
                  <span>{f.wer ?? "Agent"}</span>
                  {f.fassung !== jetzt && (
                    <button
                      data-art="still"
                      disabled={gesperrt}
                      onClick={() =>
                        schicke(
                          { zurueck: f.fassung },
                          `Zurück auf den Text von Fassung ${f.fassung}. ` +
                            "Die Historie bleibt vollständig.",
                        )
                      }
                    >
                      Diesen Text wieder nehmen
                    </button>
                  )}
                </span>
                <span className="protokoll">{f.koerper_text}</span>
              </div>
            ))}
          </div>
          <p className="hinweis">
            Zurückgehen löscht nichts: Der alte Text wird als neue Fassung
            angefügt. Bei einer Mahnung muss nachvollziehbar bleiben,
            welcher Wortlaut wann entstand.
          </p>
        </details>
      )}
    </div>
  );
}
