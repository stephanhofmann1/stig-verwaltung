"use client";

import { useState } from "react";

/**
 * Prüft die festgeschriebenen Zuordnungen gegen die heutigen Regeln.
 *
 * WARUM AUF KNOPFDRUCK UND NICHT BEIM SEITENAUFRUF
 *
 * Die Prüfung sieht jede Zuordnung an und rechnet Summen über die
 * Belege. Bei jedem Aufruf der Belegseite wäre das verschenkte Zeit --
 * gebraucht wird sie nach einer Regeländerung und nach einer
 * Einlieferung. Darum ein Knopf, der sagt, was er tut.
 *
 * WARUM SIE NICHTS ÄNDERT
 *
 * Gelöst wird in der Liste darunter, von Hand. Eine Prüfung, die selbst
 * aufräumt, nimmt einem die Möglichkeit, ihr zu widersprechen -- und
 * genau diese Möglichkeit ist der Grund, warum man dem selbsttätigen
 * Abgleich überhaupt ins Hauptbuch schreiben lässt.
 */

interface Beanstandung {
  zuordnung_id?: string;
  beleg_id?: string;
  id?: string;
  dateiname: string | null;
  aussteller: string | null;
  belegdatum?: string | null;
  buchungstag?: string | null;
  betrag?: string | null;
  betrag_brutto?: string | null;
  zugeordnet?: string | null;
  zuordnungen?: string | null;
  tage?: string | null;
  begruendung?: string | null;
}

interface Befund {
  geprueft: number;
  fenster: { vorlauf_tage: number; nachlauf_tage: number };
  mehrfach_genutzt: Beanstandung[];
  ausserhalb_zeitfenster: Beanstandung[];
  ueberzogen: Beanstandung[];
  sauber: boolean;
}

const euro = (w: string | number | null | undefined) =>
  w === null || w === undefined
    ? "ohne Betrag"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(Math.abs(Number(w)));

const tag = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE") : "ohne Datum";

const bezeichne = (b: Beanstandung) =>
  b.aussteller ?? b.dateiname ?? "Beleg ohne Namen";

export function Bestandspruefung() {
  const [befund, setBefund] = useState<Befund | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function pruefe() {
    setLaeuft(true);
    setFehler(null);
    try {
      const r = await fetch("/api/belege/pruefung");
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Die Prüfung ist nicht durchgelaufen.");
        return;
      }
      setBefund(await r.json());
    } catch {
      setFehler("Die Prüfung ist nicht durchgelaufen.");
    } finally {
      setLaeuft(false);
    }
  }

  const zahl = befund
    ? befund.mehrfach_genutzt.length +
      befund.ausserhalb_zeitfenster.length +
      befund.ueberzogen.length
    : 0;

  return (
    <>
      <div className="knopfreihe">
        <button
          type="button"
          className="knopf"
          disabled={laeuft}
          onClick={() => void pruefe()}
        >
          {laeuft ? "prüft …" : "Zuordnungen prüfen"}
        </button>
        {befund && (
          <span className="still">
            {befund.geprueft} Zuordnungen geprüft ·{" "}
            {zahl === 0 ? "nichts zu beanstanden" : `${zahl} zu prüfen`}
          </span>
        )}
      </div>

      {fehler && <p className="hinweis">{fehler}</p>}

      {befund && befund.sauber && (
        <p className="hinweis">
          Alle {befund.geprueft} festgeschriebenen Zuordnungen halten die
          heutigen Regeln ein: kein Beleg belegt mehr, als er hergibt, und
          keine Abbuchung liegt mehr als {befund.fenster.nachlauf_tage} Tage
          nach oder {befund.fenster.vorlauf_tage} Tage vor ihrem Belegdatum.
        </p>
      )}

      {befund && befund.mehrfach_genutzt.length > 0 && (
        <div className="register">
          <h3>Ein Beleg an mehreren Abbuchungen</h3>
          <p className="hinweis">
            Hier ist mehr zugeordnet, als der Beleg hergibt — oder der Betrag
            des Belegs ist unbekannt. Bei einer Ratenzahlung ist das richtig;
            sonst belegt ein Beleg zwei Ausgaben.
          </p>
          {befund.mehrfach_genutzt.map((b) => (
            <div className="posten" key={b.id}>
              <div className="posten-kopf">
                <span className="ziffern">{euro(b.betrag_brutto)}</span>
                <span className="still">
                  {b.zuordnungen}× zugeordnet, zusammen {euro(b.zugeordnet)}
                </span>
              </div>
              <a className="posten" href={`/api/belege/${b.id}/datei`}>
                {bezeichne(b)} · {tag(b.belegdatum)}
              </a>
            </div>
          ))}
        </div>
      )}

      {befund && befund.ausserhalb_zeitfenster.length > 0 && (
        <div className="register">
          <h3>Zeitlich unmöglich</h3>
          <p className="hinweis">
            Die Abbuchung liegt außerhalb des Fensters um das Belegdatum. Eine
            Zahlung vor dem Belegdatum kann es geben (Vorkasse, Abonnement),
            aber nicht um Monate. Treffer über eine Belegnummer im
            Verwendungszweck sind hier ausgenommen — dort ist das Datum
            gleichgültig.
          </p>
          {befund.ausserhalb_zeitfenster.map((b) => (
            <div className="posten" key={b.zuordnung_id}>
              <div className="posten-kopf">
                <span className="ziffern">{euro(b.betrag)}</span>
                <span className="still">
                  Beleg {tag(b.belegdatum)} · Abbuchung {tag(b.buchungstag)} ·{" "}
                  {Number(b.tage) < 0
                    ? `${-Number(b.tage)} Tage davor`
                    : `${b.tage} Tage danach`}
                </span>
              </div>
              <a className="posten" href={`/api/belege/${b.beleg_id}/datei`}>
                {bezeichne(b)}
              </a>
              {b.begruendung && <div className="hinweis">{b.begruendung}</div>}
            </div>
          ))}
        </div>
      )}

      {befund && befund.ueberzogen.length > 0 && (
        <div className="register">
          <h3>Mehr zugeordnet als der Beleg hergibt</h3>
          {befund.ueberzogen.map((b) => (
            <div className="posten" key={b.id}>
              <div className="posten-kopf">
                <span className="ziffern">{euro(b.betrag_brutto)}</span>
                <span className="still">
                  zugeordnet: {euro(b.zugeordnet)}
                </span>
              </div>
              <a className="posten" href={`/api/belege/${b.id}/datei`}>
                {bezeichne(b)}
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
