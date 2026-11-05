"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Herkunft, type HerkunftDaten } from "@/components/Herkunft";
import {
  KATEGORIE_LABEL,
  STATUS_LABEL,
  HEIKLE_KATEGORIEN,
  type Kategorie,
  type VorgangStatus,
} from "@/lib/typen";
import {
  BEGRUENDUNG_MINDESTLAENGE,
  OHNE_ANTWORT_MINDESTLAENGE,
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
 *
 * DREI DINGE KOMMEN AM 03.11.2026 HINZU
 *
 *   - "Hier nicht antworten": Der Vorgang laesst sich mit Grund
 *     schliessen, ohne dass eine Antwort hinausgeht. Vorher gab es nur
 *     beantworten oder liegenlassen, und Liegenlassen sah aus wie Arbeit,
 *     die noch wartet -- die Kennzahl "wartet auf Freigabe" zaehlte den
 *     Vorgang mit. Der Grund ist Pflicht: In einem Jahr ist er die
 *     einzige Auskunft darueber, was mit dieser Mail geschehen ist.
 *
 *   - Die Herkunft der Einordnung steht ueber den Schaltern. Wer eine
 *     Kategorie berichtigen soll, muss sehen, worauf die falsche beruhte
 *     -- am 03.11.2026 war das das Stichwort "Bescheid" in der Wendung
 *     "Geben Sie mir Bescheid".
 *
 *   - "Entwurf nachziehen": Nimmt eine Berichtigung die Kategorie aus
 *     einer heiklen heraus, entsteht der Entwurf nicht von allein -- der
 *     Agent laeuft nur ueber offene Faelle, bei denen er noch nicht
 *     abgelehnt hat. Genau das fehlte am 03.11.2026, und genau das macht
 *     dieser Knopf.
 *
 * Der Stand dazu wird hier geholt (GET /api/vorgang/[id]) und nicht als
 * Eigenschaft hereingegeben: Die Seite, die diesen Schalter rendert
 * (app/vorgang/[id]/page.tsx), gehoert nicht zu dieser Aenderung. Eine
 * neue Pflichteigenschaft haette sie zerbrochen.
 */

interface Props {
  id: string;
  status: VorgangStatus;
  kategorie: Kategorie;
  heikel: boolean;
}

/** Was GET /api/vorgang/[id] liefert. */
interface Stand {
  einordnung_quelle: string | null;
  einordnung_stichwort: string | null;
  einordnung_fundstelle: string | null;
  kein_entwurf_code: string | null;
  kein_entwurf_grund: string | null;
  ohne_antwort_grund: string | null;
  ohne_antwort_am: string | null;
  offene_entwuerfe: number;
  hat_eingang: boolean;
  entwurf_nachziehbar: boolean;
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

  // Dasselbe Muster fuer "hier nicht antworten": zu starten, damit das
  // Schliessen eines Vorgangs ohne Antwort eine eigene Entscheidung ist
  // und nicht ein Klick neben dem Erledigt-Knopf.
  const [ohneOffen, setOhneOffen] = useState(false);
  const [ohneGrund, setOhneGrund] = useState("");

  const [stand, setStand] = useState<Stand | null>(null);

  /**
   * Holt den Steuerungsstand -- und setzt nichts, siehe EntwurfKarte:
   * ein setState unmittelbar im Effektkoerper loest Folgedarstellungen
   * aus. Ohne diesen Stand fehlen Herkunft und Nachziehknopf; die
   * Schalter selbst muessen auch dann gehen, deshalb null statt Fehler.
   */
  const ladeStand = useCallback(async (): Promise<Stand | null> => {
    try {
      const r = await fetch(`/api/vorgang/${p.id}`);
      if (!r.ok) return null;
      const d = (await r.json()) as Stand & { ok?: boolean };
      return d.ok ? d : null;
    } catch {
      return null;
    }
  }, [p.id]);

  useEffect(() => {
    let aktuell = true;
    void ladeStand().then((d) => {
      if (aktuell && d) setStand(d);
    });
    return () => {
      aktuell = false;
    };
  }, [ladeStand]);

  const blockiert = busy || laeuft;
  const kategorieGeaendert = kategorie !== p.kategorie;
  const grundReicht = sperreGrund.trim().length >= BEGRUENDUNG_MINDESTLAENGE;

  /**
   * `entwurf_nachziehen` steht nicht in `Wunsch` (lib/vorgangstatus.ts):
   * Es ist keine Aenderung am Vorgang, sondern eine Bitte an den Agenten,
   * und die reine Entscheidungslogik dort soll davon nichts wissen. Die
   * Route kennt das Feld und behandelt es getrennt.
   */
  async function schicke(
    wunsch: Wunsch & { entwurf_nachziehen?: boolean },
    erfolg: string,
  ) {
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
      setOhneOffen(false);
      setOhneGrund("");
      void ladeStand().then((d) => d && setStand(d));
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
      <div className="titelzeile" data-rang="klein">
        <h2>Bearbeiten</h2>
        <span className="zaehler">{STATUS_LABEL[p.status]}</span>
      </div>

      {/* Worauf die Einordnung beruht -- UEBER den Schaltern, weil es die
          Grundlage der Entscheidung ist, die hier getroffen wird. */}
      {stand && (
        <Herkunft
          titel="Worauf diese Einordnung beruht"
          daten={
            {
              kategorie: p.kategorie,
              heikel: p.heikel,
              einordnung_quelle: stand.einordnung_quelle,
              einordnung_stichwort: stand.einordnung_stichwort,
              einordnung_fundstelle: stand.einordnung_fundstelle,
              kein_entwurf_code: stand.kein_entwurf_code,
              kein_entwurf_grund: stand.kein_entwurf_grund,
              // Der Entwurf selbst steht in seiner eigenen Karte oben in
              // der Akte; hier geht es um den Vorgang.
              entwurf_quelle: null,
              entwurf_modell: null,
              entwurf_fassung_nr: null,
              ohne_antwort_grund: stand.ohne_antwort_grund,
            } satisfies HerkunftDaten
          }
        />
      )}

      {/* Der Entwurf, der nach einer Berichtigung fehlt. */}
      {stand?.entwurf_nachziehbar && (
        <>
          <div className="knopfreihe">
            <button
              onClick={() =>
                schicke(
                  { entwurf_nachziehen: true },
                  "Der Agent hat den Vorgang erneut angesehen. Ein Entwurf " +
                    "steht, falls er einen schreiben konnte — die Freigabe " +
                    "zeigt ihn.",
                )
              }
              disabled={blockiert}
            >
              Entwurf jetzt erzeugen
            </button>
          </div>
          <p className="erklaerung">
            Zu diesem Vorgang liegt kein Entwurf. Der Agent läuft von sich
            aus nur über Fälle, bei denen er noch nicht abgelehnt hat — nach
            einer Berichtigung muss der Entwurf deshalb hier angestoßen
            werden. Es entsteht ein Entwurf, nichts wird gesendet.
          </p>
        </>
      )}

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
      <div className="feldraster abschnitt">
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

      {/* --- Hier nicht antworten -------------------------------------- */}
      {/* Ohne Inline-Stil, anders als die Nachbarabschnitte dieser Datei:
          Die kleinere Stufe kommt ueber data-rang="klein" (globals.css,
          Abschnitt 14i) -- dieselbe wie bei "Sperre fuer die Automatik"
          darunter, denn beides sind Abschnitte INNERHALB der Akte und
          nicht neben ihr. */}
      <div className="titelzeile abschnitt" data-rang="klein">
        <h2>Hier nicht antworten</h2>
      </div>

      {stand?.ohne_antwort_grund ? (
        <div className="meldung" data-art="info">
          <strong>Ohne Antwort geschlossen</strong>
          {stand.ohne_antwort_grund}
        </div>
      ) : !ohneOffen ? (
        <>
          <div className="knopfreihe">
            <button
              data-art="still"
              onClick={() => setOhneOffen(true)}
              disabled={blockiert}
            >
              Ohne Antwort schließen …
            </button>
          </div>
          <p className="erklaerung">
            Für Mails, die keine Antwort brauchen: zur Kenntnis genommen,
            erledigt sich von selbst, falsch zugestellt. Der Vorgang geht
            auf „Erledigt“ und fällt damit aus der Zahl der offenen Fälle.
            Liegenlassen sah bisher aus wie Arbeit, die noch wartet.
          </p>
        </>
      ) : (
        <>
          <label className="feld">
            Warum braucht das keine Antwort? (Pflicht, mindestens{" "}
            {OHNE_ANTWORT_MINDESTLAENGE} Zeichen)
            <input
              type="text"
              value={ohneGrund}
              onChange={(e) => setOhneGrund(e.target.value)}
              placeholder="z. B. nur zur Kenntnis, Rundschreiben des Versorgers"
              disabled={blockiert}
              autoFocus
            />
          </label>
          <div className="knopfreihe">
            <button
              onClick={() =>
                schicke(
                  { ohne_antwort: ohneGrund },
                  "Ohne Antwort geschlossen. Der Grund steht am Vorgang.",
                )
              }
              disabled={
                blockiert ||
                ohneGrund.trim().length < OHNE_ANTWORT_MINDESTLAENGE
              }
            >
              Ohne Antwort schließen
            </button>
            <button
              data-art="still"
              onClick={() => {
                setOhneOffen(false);
                setOhneGrund("");
              }}
              disabled={blockiert}
            >
              Abbrechen
            </button>
            {stand && stand.offene_entwuerfe > 0 && (
              <span className="rueckmeldung" data-art="warn">
                {stand.offene_entwuerfe === 1
                  ? "Der offene Entwurf wird dabei verworfen."
                  : `Die ${stand.offene_entwuerfe} offenen Entwürfe werden dabei verworfen.`}
              </span>
            )}
          </div>
          <p className="erklaerung">
            Ein noch offener Entwurf wird mit verworfen — sonst stünde er
            weiter in der Freigabe und in der Zahl „wartet auf Freigabe“,
            bei einem Vorgang, auf den bewusst nicht geantwortet wird.
          </p>
        </>
      )}

      {/* --- heikel ---------------------------------------------------- */}
      <div className="titelzeile" data-rang="klein">
        <h2>Sperre für die Automatik</h2>
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
