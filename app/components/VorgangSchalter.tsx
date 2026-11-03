"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  KATEGORIE_LABEL,
  STATUS_LABEL,
  HEIKLE_KATEGORIEN,
  type Kategorie,
  type VorgangStatus,
} from "@/lib/typen";
import {
  BEGRUENDUNG_MINDESTLAENGE,
  erlaubteStatus,
  statusKnopf,
  type Wunsch,
} from "@/lib/vorgangstatus";

/**
 * Die Bedienung der Vorgangsakte.
 *
 * Die Seite bot bisher genau eine Handlung an: "Zurueck zur Uebersicht".
 * Erledigt, wartet, falsche Kategorie, falsche Heikel-Markierung -- alles
 * nur in der Datenbank. Hier stehen jetzt die vier Entscheidungen, die ein
 * Vermieter an einer Akte tatsaechlich trifft.
 *
 * Drei Entscheidungen zur Form:
 *
 *   1. Kein window.confirm und kein alert. Beide halten die ganze
 *      Oberflaeche an, und auf dem Telefon sehen sie aus wie eine Meldung
 *      der Seite, der man nicht trauen soll. Die Rueckfrage beim Aufheben
 *      von "heikel" steht deshalb in der Seite selbst: ein zweiter
 *      Schritt mit Pflichtbegruendung, der sich abbrechen laesst.
 *
 *   2. Die Regel, welcher Wechsel erlaubt ist, wird hier nicht
 *      nachgebaut. Welche Knoepfe erscheinen, sagt erlaubteStatus() aus
 *      lib/vorgangstatus.ts -- dieselbe Funktion, die auch die
 *      Schnittstelle fragt. Zwei Kopien derselben Regel heisst, dass eine
 *      davon irgendwann falsch ist.
 *
 *   3. Der Browser schickt nur, was sich aendern soll, nie den ganzen
 *      Vorgang. Was gilt, liest die Schnittstelle selbst aus der Tabelle
 *      und sperrt die Zeile dafuer. Ein Stand aus einem Fenster, das seit
 *      einer Stunde offen steht, kann so nichts ueberschreiben.
 */

interface Props {
  id: string;
  status: VorgangStatus;
  kategorie: Kategorie;
  heikel: boolean;
}

type Meldung = { art: "gut" | "warn" | "fehler"; text: string };

const KATEGORIEN = Object.keys(KATEGORIE_LABEL) as Kategorie[];

export function VorgangSchalter(p: Props) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  const [kategorie, setKategorie] = useState<Kategorie>(p.kategorie);
  const [kategorieGrund, setKategorieGrund] = useState("");

  // Der zweite Schritt beim Aufheben der Sperre. Startet immer zu --
  // sonst waere das Textfeld die ganze Zeit sichtbar und die Aufhebung
  // ein Klick mit Tippen davor, statt einer eigenen Entscheidung.
  const [sperreOffen, setSperreOffen] = useState(false);
  const [sperreGrund, setSperreGrund] = useState("");

  const blockiert = busy || laeuft;
  const kategorieGeaendert = kategorie !== p.kategorie;
  const grundReicht = sperreGrund.trim().length >= BEGRUENDUNG_MINDESTLAENGE;

  async function schicke(wunsch: Wunsch, erfolg: string) {
    setBusy(true);
    setMeldung(null);
    try {
      const r = await fetch(`/api/vorgang/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wunsch),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        fehler?: string;
      };
      if (!r.ok || !d.ok) {
        setMeldung({
          art: "fehler",
          text: d.fehler ?? "Das hat nicht geklappt.",
        });
        return;
      }
      setMeldung({ art: "gut", text: erfolg });
      setSperreOffen(false);
      setSperreGrund("");
      setKategorieGrund("");
      // Der Kopf der Akte, die Zaehler und das Protokoll darunter stehen
      // in der Serverseite. Ohne refresh zeigt die Seite den alten Stand,
      // und nur der Knopf hier haette sich bewegt.
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="abschnitt">
      <div className="titelzeile">
        <h2>Bearbeiten</h2>
        <span className="zaehler">{STATUS_LABEL[p.status]}</span>
      </div>

      {/* --- Status ---------------------------------------------------- */}
      <div className="knopfreihe">
        {erlaubteStatus(p.status).map((ziel) => (
          <button
            key={ziel}
            onClick={() =>
              schicke(
                { status: ziel },
                `Vorgang steht auf „${STATUS_LABEL[ziel]}“.`,
              )
            }
            disabled={blockiert}
            data-art={ziel === "erledigt" ? undefined : "still"}
          >
            {statusKnopf(p.status, ziel)}
          </button>
        ))}
      </div>
      <p className="erklaerung">
        {p.status === "erledigt"
          ? "Erledigte Vorgänge zählt die Übersicht nicht mehr als offen. " +
            "Kommt doch noch eine Antwort, öffnet sie der Knopf oben wieder."
          : "„Wartet“ heißt: draußen ist jemand dran. „Erledigt“ nimmt den " +
            "Vorgang aus der Zahl der offenen Fälle in der Übersicht."}
      </p>

      {/* --- Kategorie ------------------------------------------------- */}
      <div className="feldraster" style={{ marginTop: "1.25rem" }}>
        <label className="feld">
          Kategorie
          <select
            value={kategorie}
            onChange={(e) => setKategorie(e.target.value as Kategorie)}
            disabled={blockiert}
          >
            {KATEGORIEN.map((k) => (
              <option key={k} value={k}>
                {KATEGORIE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="feld">
          Grund der Umbuchung (freiwillig)
          <input
            type="text"
            value={kategorieGrund}
            onChange={(e) => setKategorieGrund(e.target.value)}
            placeholder="z. B. Messdienstleister, keine Behörde"
            disabled={blockiert}
          />
        </label>
      </div>
      <div className="knopfreihe">
        <button
          onClick={() =>
            schicke(
              { kategorie, begruendung: kategorieGrund },
              `Umgebucht auf „${KATEGORIE_LABEL[kategorie]}“.`,
            )
          }
          disabled={blockiert || !kategorieGeaendert}
        >
          Kategorie übernehmen
        </button>
        {kategorieGeaendert && (
          <span className="rueckmeldung">
            Noch nicht gespeichert — der Knopf übernimmt die Änderung.
          </span>
        )}
      </div>
      {kategorieGeaendert && HEIKLE_KATEGORIEN.includes(kategorie) && !p.heikel && (
        <p className="erklaerung">
          „{KATEGORIE_LABEL[kategorie]}“ gilt als heikle Kategorie. Die
          Sperre wird dadurch nicht von allein gesetzt — wenn der Agent hier
          nicht antworten soll, unten ausdrücklich markieren.
        </p>
      )}

      {/* --- heikel ---------------------------------------------------- */}
      <div className="titelzeile" style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Sperre für die Automatik</h2>
      </div>

      {p.heikel ? (
        <>
          <div className="meldung" data-art="warnung">
            <strong>Markiert als heikel</strong>
            Der Agent schreibt hier keinen Entwurf vor. Das ist die Sperre,
            an der die Automatik anhält — gedacht für Mahnungen,
            Kündigungen und Behördenpost.
          </div>
          {!sperreOffen ? (
            <div className="knopfreihe">
              <button
                data-art="still"
                onClick={() => setSperreOffen(true)}
                disabled={blockiert}
              >
                Sperre aufheben …
              </button>
            </div>
          ) : (
            <>
              <label className="feld">
                Warum ist dieser Vorgang nicht heikel? (Pflicht, mindestens{" "}
                {BEGRUENDUNG_MINDESTLAENGE} Zeichen)
                <input
                  type="text"
                  value={sperreGrund}
                  onChange={(e) => setSperreGrund(e.target.value)}
                  placeholder="z. B. Messdienstleister, nur Terminabstimmung — keine Behörde, keine Frist"
                  disabled={blockiert}
                  autoFocus
                />
              </label>
              <div className="knopfreihe">
                <button
                  onClick={() =>
                    schicke(
                      { heikel: false, begruendung: sperreGrund },
                      "Sperre aufgehoben. Der Grund steht im Protokoll.",
                    )
                  }
                  disabled={blockiert || !grundReicht}
                >
                  Aufhebung bestätigen
                </button>
                <button
                  data-art="still"
                  onClick={() => {
                    setSperreOffen(false);
                    setSperreGrund("");
                  }}
                  disabled={blockiert}
                >
                  Abbrechen
                </button>
                {!grundReicht && (
                  <span className="rueckmeldung" data-art="warn">
                    Ohne Begründung bleibt die Sperre stehen.
                  </span>
                )}
              </div>
            </>
          )}
          <p className="erklaerung">
            Die Aufhebung lässt die Automatik an diese Akte heran. Sie
            braucht deshalb einen zweiten Schritt und einen Grund, und beides
            landet im Protokoll unter diesem Abschnitt — nachlesbar, ohne in
            die Datenbank zu sehen.
          </p>
        </>
      ) : (
        <>
          <div className="knopfreihe">
            <button
              data-art="still"
              onClick={() =>
                schicke(
                  { heikel: true },
                  "Als heikel markiert. Der Agent hält hier an.",
                )
              }
              disabled={blockiert}
            >
              Als heikel markieren
            </button>
          </div>
          <p className="erklaerung">
            Vorsicht zu erhöhen braucht keinen Grund und geht mit einem
            Klick. Das Zurücknehmen nicht — dafür verlangt diese Seite eine
            Begründung.
          </p>
        </>
      )}

      {meldung && (
        <div
          className="meldung"
          data-art={meldung.art === "gut" ? "gut" : meldung.art === "warn" ? "warnung" : "fehler"}
        >
          <strong>
            {meldung.art === "fehler" ? "Nicht geändert" : "Übernommen"}
          </strong>
          {meldung.text}
        </div>
      )}
    </section>
  );
}
