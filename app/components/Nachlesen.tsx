"use client";

import { useState } from "react";

/**
 * Den Lauf „abgelegte Belege neu lesen" von Hand anstoßen.
 *
 * WOFÜR
 *
 * Die Route api/belege/nachlesen gab es schon, aber keinen Weg, sie zu
 * benutzen: Sie ließ sich nur von Hand aufrufen. Damit lag die
 * wichtigste Eigenschaft des Systems -- dass eine verbesserte Regel
 * auch auf den Bestand wirkt -- hinter einem Werkzeug, das niemand in
 * der Oberfläche findet.
 *
 * ZWEI SCHRITTE
 *
 * Der erste Druck ist ein Probelauf: Er liest und berichtet, ohne zu
 * schreiben. Erst der zweite übernimmt. Das ist hier wichtiger als
 * sonst, denn ein aufgelöster Widerspruchsvermerk hebt den Beleg
 * zurück in den Zustand, aus dem der selbsttätige Abgleich wieder ins
 * Hauptbuch schreiben darf.
 */

interface Aenderung {
  beleg_id: string;
  datei: string | null;
  betrag_alt: number | null;
  betrag_neu: number | null;
  datum_alt: string | null;
  datum_neu: string | null;
  vermerk_loest: boolean;
  vermerk_neu: string | null;
}

interface Vermerk {
  beleg_id: string;
  datei: string | null;
  zugeordnet: number;
  alt: string;
  beifuegung: { betrag: number | null; datum: string | null } | null;
  neu: { betrag: number | null; datum: string | null };
  frisch: string | null;
  lage: string;
}

interface Bericht {
  probelauf: boolean;
  belege: number;
  gelesen: number;
  ohne_datei: number;
  ohne_textebene: number;
  unveraendert: number;
  betrag_uneindeutig: number;
  vermerk_loest_sich: number;
  vermerk_bleibt: number;
  mit_vermerk: number;
  vermerke: Vermerk[];
  wuerde_sich_aendern: number;
  geschrieben: number;
  gesperrt: number;
  beispiele_gesperrt: Array<{ datei: string | null; grund: string }>;
  aenderungen: Aenderung[];
  abgleich: unknown;
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

export function Nachlesen() {
  const [bericht, setBericht] = useState<Bericht | null>(null);
  const [laeuft, setLaeuft] = useState<"nein" | "lesen" | "schreiben">("nein");
  const [fehler, setFehler] = useState<string | null>(null);

  async function lauf(uebernehmen: boolean) {
    setLaeuft(uebernehmen ? "schreiben" : "lesen");
    setFehler(null);
    try {
      const r = await fetch("/api/belege/nachlesen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uebernehmen }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Das Nachlesen ist nicht durchgelaufen.");
        return;
      }
      const d = (await r.json()) as Bericht;
      setBericht(d);
      if (!d.probelauf && d.geschrieben > 0) {
        // Die Listen auf dieser Seite zeigen sonst einen Stand, den es
        // nicht mehr gibt.
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
        {bericht && bericht.probelauf && bericht.wuerde_sich_aendern > 0 && (
          <button
            type="button"
            className="knopf"
            disabled={laeuft !== "nein"}
            onClick={() => void lauf(true)}
          >
            {laeuft === "schreiben"
              ? "übernimmt …"
              : `${bericht.wuerde_sich_aendern} übernehmen`}
          </button>
        )}
      </div>

      {fehler && <p className="hinweis">{fehler}</p>}

      {bericht && (
        <>
          <p className="hinweis">
            {bericht.gelesen} von {bericht.belege} Belegen gelesen ·{" "}
            <strong>{bericht.wuerde_sich_aendern}</strong>{" "}
            {bericht.probelauf ? "würden sich ändern" : "geändert"} · davon{" "}
            {bericht.vermerk_loest_sich} mit einem Vermerk, der sich auflöst ·{" "}
            {bericht.unveraendert} unverändert
            {bericht.vermerk_bleibt > 0
              ? ` · ${bericht.vermerk_bleibt} bleiben strittig`
              : ""}
            {bericht.gesperrt > 0
              ? ` · ${bericht.gesperrt} schon zugeordnet und darum unangetastet`
              : ""}
            {bericht.betrag_uneindeutig > 0
              ? ` · ${bericht.betrag_uneindeutig} mit nicht bestimmbarem Betrag`
              : ""}
            {bericht.ohne_textebene > 0
              ? ` · ${bericht.ohne_textebene} ohne Textebene`
              : ""}
            {bericht.mit_vermerk > 0
              ? ` · ${bericht.mit_vermerk} tragen einen Widerspruchsvermerk`
              : ""}
            {bericht.probelauf ? " — nichts geschrieben." : ""}
          </p>

          {/*
            Jeder Beleg mit Vermerk, einzeln. Ohne diese Liste meldet der
            Lauf "0 lösen sich auf" und sagt nicht, warum -- die Fälle
            verschwinden in "unverändert" und "schon zugeordnet".
          */}
          {bericht.vermerke.length > 0 && (
            <div className="register">
              {bericht.vermerke.map((v) => (
                <div className="posten" key={`v-${v.beleg_id}`}>
                  <div className="posten-kopf">
                    <span className="marker">{v.lage}</span>
                    <a href={`/api/belege/${v.beleg_id}/datei`}>
                      {v.datei ?? "ohne Namen"}
                    </a>
                  </div>
                  <div className="still">
                    Vermerk: {v.alt}
                  </div>
                  <div className="still">
                    heute gelesen: {euro(v.neu.betrag)} / {tag(v.neu.datum)} ·
                    Beifügung:{" "}
                    {v.beifuegung
                      ? `${euro(v.beifuegung.betrag)} / ${tag(v.beifuegung.datum)}`
                      : "nicht aus dem Text lesbar"}
                  </div>
                  {v.frisch && (
                    <div className="hinweis">Bleibt: {v.frisch}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {bericht.beispiele_gesperrt.length > 0 && (
            <p className="hinweis">
              Unangetastet, weil schon zugeordnet:{" "}
              {bericht.beispiele_gesperrt
                .map((g) => g.datei ?? "ohne Namen")
                .join(", ")}
              . Die Zuordnung gilt für den alten Betrag und wird nicht von
              hinten verändert.
            </p>
          )}

          <div className="register">
            {bericht.aenderungen.map((a) => (
              <div className="posten" key={a.beleg_id}>
                <div className="posten-kopf">
                  {a.vermerk_loest && (
                    <span className="marker">Vermerk löst sich auf</span>
                  )}
                  <a href={`/api/belege/${a.beleg_id}/datei`}>
                    {a.datei ?? "ohne Namen"}
                  </a>
                </div>
                <div className="still">
                  {euro(a.betrag_alt)} → {euro(a.betrag_neu)} ·{" "}
                  {tag(a.datum_alt)} → {tag(a.datum_neu)}
                </div>
                {a.vermerk_neu && (
                  <div className="hinweis">
                    Bleibt strittig: {a.vermerk_neu}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
