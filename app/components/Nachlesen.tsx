"use client";

import { useState } from "react";

/**
 * Belege mit Abweichung mit den heutigen Regeln neu lesen.
 *
 * WOFÜR
 *
 * Das Regelwerk wird besser, die abgelegten Belege werden es nicht mit.
 * Was beim Einliefern falsch gelesen wurde, bleibt falsch gelesen --
 * die Datei liegt auf der Platte, die Regel ist repariert, und es gab
 * keinen Weg, die eine auf die andere anzuwenden.
 *
 * Am 07.11.2026 hingen an 19 solchen Vermerken 43 offene
 * Amazon-Zahlungen, die ihre Bestellnummer im Verwendungszweck tragen
 * -- also den verlässlichsten Treffer, den der Abgleich kennt. Ein
 * Beleg mit Vermerk wird vom Abgleich bewusst nicht angenommen.
 *
 * ZWEI SCHRITTE
 *
 * Der erste Druck liest nur und berichtet. Erst der zweite schreibt.
 * Das ist hier wichtiger als sonst: Ein aufgelöster Vermerk hebt den
 * Beleg zurück in den Zustand, aus dem der selbsttätige Abgleich wieder
 * ins Hauptbuch schreiben darf. Wer das anstößt, soll vorher sehen, was
 * dabei herauskommt.
 */

interface Befund {
  beleg_id: string;
  dateiname: string | null;
  aussteller: string | null;
  alt: { betrag: number | null; datum: string | null };
  neu: { betrag: number | null; datum: string | null };
  beifuegung: { betrag: number | null; datum: string | null } | null;
  ergebnis: string;
  hinweis?: string;
}

interface Bericht {
  geaendert: boolean;
  geprueft: number;
  aufgeloest: number;
  bleibt: number;
  ohne_zweiten_zeugen: number;
  unlesbar: number;
  befunde: Befund[];
}

const euro = (w: number | null) =>
  w === null
    ? "ohne Betrag"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(w);

const tag = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE") : "ohne Datum";

const NAMEN: Record<string, string> = {
  aufgeloest: "löst sich auf",
  bleibt: "bleibt strittig",
  ohne_zweiten_zeugen: "kein zweiter Zeuge",
  unlesbar: "Datei nicht lesbar",
};

export function Nachlesen() {
  const [bericht, setBericht] = useState<Bericht | null>(null);
  const [laeuft, setLaeuft] = useState<"nein" | "lesen" | "schreiben">("nein");
  const [fehler, setFehler] = useState<string | null>(null);

  async function lauf(aendern: boolean) {
    setLaeuft(aendern ? "schreiben" : "lesen");
    setFehler(null);
    const koerper = new FormData();
    if (aendern) koerper.set("aendern", "1");
    try {
      const r = await fetch("/api/belege/nachlesen", {
        method: "POST",
        body: koerper,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Das Nachlesen ist nicht durchgelaufen.");
        return;
      }
      const d = (await r.json()) as Bericht;
      setBericht(d);
      if (d.geaendert && d.aufgeloest > 0) {
        // Die Liste darüber zeigt sonst Belege, die es dort nicht mehr
        // gibt.
        window.location.reload();
      }
    } catch {
      setFehler("Das Nachlesen ist nicht durchgelaufen.");
    } finally {
      setLaeuft("nein");
    }
  }

  return (
    <>
      <div className="knopfreihe">
        <button
          type="button"
          className="knopf"
          disabled={laeuft !== "nein"}
          onClick={() => void lauf(false)}
        >
          {laeuft === "lesen" ? "liest …" : "Mit den heutigen Regeln nachlesen"}
        </button>
        {bericht && !bericht.geaendert && bericht.aufgeloest > 0 && (
          <button
            type="button"
            className="knopf"
            disabled={laeuft !== "nein"}
            onClick={() => void lauf(true)}
          >
            {laeuft === "schreiben"
              ? "übernimmt …"
              : `${bericht.aufgeloest} übernehmen`}
          </button>
        )}
      </div>

      {fehler && <p className="hinweis">{fehler}</p>}

      {bericht && (
        <>
          <p className="hinweis">
            {bericht.geprueft} angesehen · <strong>{bericht.aufgeloest}</strong>{" "}
            lösen sich mit den heutigen Regeln auf · {bericht.bleibt} bleiben
            strittig
            {bericht.ohne_zweiten_zeugen > 0
              ? ` · ${bericht.ohne_zweiten_zeugen} ohne zweiten Zeugen`
              : ""}
            {bericht.unlesbar > 0 ? ` · ${bericht.unlesbar} nicht lesbar` : ""}
            {bericht.geaendert ? " — übernommen." : " — nichts geändert."}
          </p>

          <div className="register">
            {bericht.befunde.map((b) => (
              <div className="posten" key={b.beleg_id}>
                <div className="posten-kopf">
                  <span className="marker">{NAMEN[b.ergebnis] ?? b.ergebnis}</span>
                  <a href={`/api/belege/${b.beleg_id}/datei`}>
                    {b.aussteller ?? b.dateiname ?? "ohne Namen"}
                  </a>
                </div>
                <div className="still">
                  bisher {euro(b.alt.betrag)} / {tag(b.alt.datum)} · neu
                  gelesen {euro(b.neu.betrag)} / {tag(b.neu.datum)}
                  {b.beifuegung
                    ? ` · Beifügung ${euro(b.beifuegung.betrag)} / ${tag(b.beifuegung.datum)}`
                    : ""}
                </div>
                {b.hinweis && <div className="hinweis">{b.hinweis}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
