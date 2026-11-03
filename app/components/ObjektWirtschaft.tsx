"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Kennwert, WirtschaftLage, WirtschaftStamm } from "@/lib/rendite";

/**
 * Die wirtschaftlichen Zahlen eines Objekts: Kennzahlenband und Formular.
 *
 * Gerechnet wird hier nichts. Jede Zahl kommt als `Kennwert` aus
 * lib/rendite.ts und wird nur formatiert -- mit einer Ausnahme, und die ist
 * keine Rechnung: Quoten kommen als Bruchzahl (0,0554) und werden fuer die
 * Anzeige mit 100 multipliziert. Alles andere waere eine zweite Rechnung
 * derselben Zahl, und zwar die, die niemand testet.
 *
 * DIE BEGRUENDUNGSZEILE IST DER ZWECK DIESER KOMPONENTE
 *
 * Ein `Kennwert` ohne Wert ist kein Fehler, sondern eine Auskunft: Er sagt
 * in `grund`, welches Feld fehlt. Darum steht unter jeder Kennzahl entweder
 * "5,54 %" oder der Satz, der erklaert, was noch gebraucht wird -- nie ein
 * Strich, nie "n/a" und nie 0.
 *
 * Und unter jeder Kennzahl MIT Wert steht die `grundlage`: woraus gerechnet
 * wurde, mit allen Eingangsbetraegen. Eine Rendite ist die Zahl, bei der
 * niemand nachrechnet; wer es doch will, soll es koennen, ohne die Datenbank
 * zu oeffnen. Deshalb ist die Aufklappzeile nicht Zierde, sondern der Grund,
 * dieser Seite ueberhaupt zu glauben.
 *
 * ZUM FORMULAR
 *
 * Zehn Felder, Betraege mit deutschem Dezimalkomma. Geschickt wird nur, was
 * sich geaendert hat; ein geleertes Feld wird als leerer String geschickt
 * und loescht den Wert (die Route macht daraus NULL). Das ist der
 * Unterschied, auf den es ankommt: NULL heisst "unbekannt" und ergibt eine
 * Kennzahl ohne Zahl, eine 0 heisst "schuldenfrei" und ergibt eine Kennzahl
 * mit Zahl. Ein Formular, das beides als "leer" schickt, koennte
 * "schuldenfrei" nicht ausdruecken.
 */

interface Props {
  objektId: string;
  /** Der gespeicherte Stand aus db/030. */
  stamm: WirtschaftStamm;
  /** Die gerechnete Lage. Fehlt sie, zeigt die Komponente nur das Formular. */
  lage?: WirtschaftLage | null;
}

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

const DE = (n: number, stellen = 2) =>
  n.toLocaleString("de-DE", {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  });

/** Ein Kennwert als Text. Nur Formatierung -- keine Entscheidung. */
function alsText(k: Kennwert): string {
  if (k.wert === null) return "—";
  switch (k.einheit) {
    case "prozent":
      return `${DE(k.wert * 100)} %`;
    case "euro":
      return `${DE(k.wert)} €`;
    case "euro_je_qm":
      return `${DE(k.wert)} €/m²`;
    case "faktor":
      return `${DE(k.wert)}-fach`;
    case "jahre":
      return `${DE(k.wert)} Jahre`;
  }
}

/** Die Kennzahlen in der Reihenfolge, in der sie gelesen werden. */
const REIHE: Array<{ feld: keyof WirtschaftLage; schild: string }> = [
  { feld: "nettomietrendite", schild: "Netto-Mietrendite" },
  { feld: "bruttomietrendite", schild: "Brutto-Mietrendite" },
  { feld: "cashflowJahr", schild: "Cashflow im Jahr" },
  { feld: "eigenkapitalrendite", schild: "Eigenkapitalrendite" },
];

/** Alles Weitere -- dieselben Kennwerte, nur eine Zeile tiefer. */
const WEITERE: Array<{ feld: keyof WirtschaftLage; schild: string }> = [
  { feld: "gesamtinvest", schild: "Gesamtinvest" },
  { feld: "rohertragGestellt", schild: "Rohertrag (gestellt, 12 Monate)" },
  { feld: "rohertragLautVertrag", schild: "Rohertrag (laut Vertrag)" },
  { feld: "bewirtschaftung", schild: "Bewirtschaftungskosten im Jahr" },
  { feld: "jahresreinertrag", schild: "Reinertrag im Jahr" },
  {
    feld: "nettomietrenditeLautVertrag",
    schild: "Netto-Mietrendite (Vertragssicht)",
  },
  {
    feld: "nettomietrenditeAufVerkehrswert",
    schild: "Netto-Mietrendite (auf Verkehrswert)",
  },
  { feld: "rohertragsfaktor", schild: "Rohertragsfaktor" },
  { feld: "reinertragsfaktor", schild: "Reinertragsfaktor" },
  { feld: "eigenkapital", schild: "Eigenkapital (Näherung)" },
  { feld: "zinsdeckung", schild: "Zinsdeckung" },
  { feld: "mieteJeQmMonat", schild: "Miete je m² und Monat" },
  { feld: "mietausfallquote", schild: "Mietausfallquote" },
  { feld: "inkassoquote", schild: "Inkassoquote" },
];

function KennwerkKarte({ k, schild }: { k: Kennwert; schild: string }) {
  return (
    <div className="karte">
      {/* data-leer="ja" nimmt dem Gedankenstrich die Farbe einer Zahl.
          Ohne das liest das Auge zuerst einen Wert, der nicht da ist --
          und die Begründungszeile darunter, die sagt was fehlt, wird zur
          Nebensache. Die Regel steht in globals.css, Abschnitt 14e. */}
      <div className="kennwerk" data-leer={k.wert === null ? "ja" : undefined}>
        <span className="kennwerk-wert betrag ziffern">{alsText(k)}</span>
        <span className="kennwerk-schild">{schild}</span>
        {/* Entweder der Grund oder die Grundlage -- nie beides, nie keines.
            Eine Kennzahl ohne eine dieser zwei Zeilen waere eine Zahl ohne
            Herkunft, und genau die soll hier nicht stehen. */}
        <span className="kennwerk-grund">{k.grund ?? k.grundlage}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------

type Schluessel = keyof WirtschaftStamm;

interface Feld {
  name: Schluessel;
  titel: string;
  art: "betrag" | "satz" | "datum";
  hinweis?: string;
  platzhalter?: string;
}

const FELDER: Feld[] = [
  {
    name: "kaufpreis",
    titel: "Kaufpreis (€, ohne Nebenkosten)",
    art: "betrag",
    hinweis: "Ohne diesen Wert gibt es keine Rendite.",
  },
  {
    name: "kaufnebenkosten",
    titel: "Kaufnebenkosten (€)",
    art: "betrag",
    hinweis: "Grunderwerbsteuer, Notar, Grundbuch, Makler.",
  },
  { name: "kaufdatum", titel: "Kaufdatum", art: "datum" },
  {
    name: "verkehrswert",
    titel: "Verkehrswert heute (€)",
    art: "betrag",
    hinweis: "Optional. Nur für die Rendite auf den heutigen Wert.",
  },
  {
    name: "bewirtschaftung_jahr",
    titel: "Bewirtschaftung je Jahr (€)",
    art: "betrag",
    hinweis:
      "Ersetzt die Belegsumme. Für Objekte, deren Kosten über eine " +
      "WEG-Abrechnung laufen.",
  },
  {
    name: "instandhaltung_je_qm",
    titel: "Instandhaltung (€/m² und Jahr)",
    art: "betrag",
    platzhalter: "0,00",
    hinweis:
      "Kalkulatorischer Ansatz, kein Vorgabewert: leer heißt „nicht " +
      "angesetzt“. Kommt zur Belegsumme hinzu — ein Jahr ohne Reparatur " +
      "ist kein Jahr ohne Bedarf.",
  },
  {
    name: "mietausfallwagnis_satz",
    titel: "Mietausfallwagnis (% des Rohertrags)",
    art: "satz",
    platzhalter: "0,00",
    hinweis:
      "Satz vom Rohertrag, kein Vorgabewert. In der Wertermittlung ein " +
      "eigener Posten (§ 32 ImmoWertV).",
  },
  {
    name: "darlehen_restschuld",
    titel: "Darlehen: Restschuld (€)",
    art: "betrag",
    hinweis: "Schuldenfrei? Dann 0 eintragen — leer heißt „unbekannt“.",
  },
  {
    name: "darlehen_zins_satz",
    titel: "Darlehen: Zinssatz (% p. a.)",
    art: "satz",
    platzhalter: "0,000",
  },
  {
    name: "darlehen_rate_monat",
    titel: "Darlehen: Rate je Monat (€)",
    art: "betrag",
    hinweis: "Die ganze Annuität, also Zins plus Tilgung.",
  },
];

/** Nachkommastellen je Art -- dieselben wie die Spalten in db/030. */
const STELLEN: Record<Feld["art"], number> = { betrag: 2, satz: 3, datum: 0 };

/**
 * Ein gespeicherter Wert als Text fuer das Eingabefeld.
 *
 * Mit deutschem Komma, denn das Feld nimmt es auch an. Ein Betrag, der als
 * "500000" im Feld steht und als "500.000,00" daneben, sieht nach zwei
 * verschiedenen Zahlen aus.
 */
function insFeld(wert: number | string | null, art: Feld["art"]): string {
  if (wert === null || wert === undefined || wert === "") return "";
  if (art === "datum") return String(wert);
  const n = Number(wert);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: STELLEN[art],
  });
}

/**
 * "1.234,56" und "1234.56" werden beide zu "1234.56" fuer die Schnittstelle.
 *
 * Der Punkt faellt nur weg, wenn ein Komma dabei ist: Sonst waere "1.234"
 * nicht entscheidbar -- eintausendzweihundertvierunddreissig oder
 * eins Komma zwei drei vier. Dieselbe Regel steht in der Route, und sie
 * steht dort nochmal, weil eine Schnittstelle sich nicht darauf verlassen
 * soll, wer vor ihr steht.
 */
function ausFeld(text: string): string | null {
  const t = text.trim();
  if (t === "") return "";
  const normiert = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : t;
  return /^\d+(\.\d+)?$/.test(normiert) ? normiert : null;
}

export function ObjektWirtschaft({ objektId, stamm, lage }: Props) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<{ art: string; text: string } | null>(
    null,
  );

  function frisch(): Record<Schluessel, string> {
    const o = {} as Record<Schluessel, string>;
    for (const f of FELDER) o[f.name] = insFeld(stamm[f.name], f.art);
    return o;
  }
  const [werte, setWerte] = useState<Record<Schluessel, string>>(frisch);

  const blockiert = busy || laeuft;

  // --- Was hat sich gegenueber dem gespeicherten Stand geaendert? ---------
  //
  // Nur das wird geschickt. Ein Feld, das hier niemand angefasst hat, kommt
  // im UPDATE nicht vor und bleibt unberuehrt.
  const aenderungen: Record<string, string> = {};
  const fehlerhaft: string[] = [];

  for (const f of FELDER) {
    const roh = werte[f.name];
    const gespeichert = insFeld(stamm[f.name], f.art);
    if (roh.trim() === gespeichert.trim()) continue;

    if (f.art === "datum") {
      aenderungen[f.name] = roh.trim();
      continue;
    }
    const n = ausFeld(roh);
    if (n === null) {
      fehlerhaft.push(`„${f.titel}“ ist keine Zahl.`);
      continue;
    }
    aenderungen[f.name] = n;
  }

  const anzahl = Object.keys(aenderungen).length;
  const bereit = anzahl > 0 && fehlerhaft.length === 0 && !blockiert;

  async function speichern() {
    setBusy(true);
    setMeldung(null);
    const r = await fetch(`/api/objekt/${objektId}/wirtschaft`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(aenderungen),
    }).catch(() => null);

    const d = (await r?.json().catch(() => ({}))) as {
      ok?: boolean;
      fehler?: string;
      geaendert?: string[];
    };
    setBusy(false);

    if (!r || !d?.ok) {
      setMeldung({
        art: "fehler",
        text: d?.fehler ?? "Das hat nicht geklappt. Nichts wurde geändert.",
      });
      return;
    }
    setMeldung({
      art: "gut",
      text: `${d.geaendert?.length ?? anzahl} Feld(er) gespeichert. Die ` +
        "Kennzahlen unten sind neu gerechnet.",
    });
    // Die Kennzahlen haengen an diesen Feldern. Ohne Neuladen stuende ueber
    // einem gerade eingetragenen Kaufpreis weiter "kein Kaufpreis erfasst".
    start(() => router.refresh());
  }

  const alleKennwerte = lage
    ? [...REIHE, ...WEITERE].map((z) => ({ ...z, k: lage[z.feld] }))
    : [];
  const ohneZahl = alleKennwerte.filter((z) => z.k.wert === null).length;

  return (
    <section className="abschnitt">
      <h2>Wirtschaftlichkeit</h2>

      {lage === null || lage === undefined ? (
        <p className="leer">
          <strong>Keine Kennzahlen geladen</strong>
          Diese Ansicht zeigt nur die Eingabefelder. Die Zahlen stehen auf der
          Objektseite.
        </p>
      ) : ohneZahl === alleKennwerte.length ? (
        <p className="leer">
          <strong>Für dieses Objekt lässt sich noch nichts rechnen</strong>
          Es fehlen die Eingangsgrößen. Was genau, steht unter jeder Kennzahl
          — meist fängt es beim Kaufpreis an. Die Felder dafür stehen weiter
          unten.
        </p>
      ) : null}

      {lage ? (
        <>
          <div className="karten">
            {REIHE.map((z) => (
              <KennwerkKarte key={z.feld} k={lage[z.feld]} schild={z.schild} />
            ))}
          </div>

          <div className="karten">
            {WEITERE.map((z) => (
              <KennwerkKarte key={z.feld} k={lage[z.feld]} schild={z.schild} />
            ))}
          </div>

          {/* Das Rechenwerk zum Nachprüfen. Nicht eingeklappt, weil es
              unwichtig wäre, sondern weil es lang ist -- aufgeklappt steht
              dort jede Eingangsgröße jeder Zahl. */}
          <details className="erklaerung">
            <summary>Woraus diese Zahlen gerechnet sind</summary>
            {/* dt und dd liegen unmittelbar im dl: .datenblatt ist ein
                zweispaltiges Raster, und ein div dazwischen wuerde beide
                in dieselbe Zelle legen. */}
            <dl className="datenblatt">
              {alleKennwerte.map((z) => (
                <Fragment key={z.feld}>
                  <dt>{z.schild}</dt>
                  <dd>
                    <span className="betrag ziffern">{alsText(z.k)}</span>{" "}
                    {z.k.grundlage}
                    {z.k.grund ? ` — ${z.k.grund}` : ""}
                  </dd>
                </Fragment>
              ))}
            </dl>
            <p className="hinweis">
              Der Rohertrag ist alles, was die Mieter schulden (Kalt,
              Nebenkosten, Möblierungszuschlag). Die Bewirtschaftungskosten
              sind alle Kosten des Objekts, umlagefähige wie nicht
              umlagefähige. Diese Netto-Mietrendite ist deshalb niedriger als
              die, mit der Anzeigen rechnen — und sie ist die, die am
              Jahresende übrig bleibt.
            </p>
          </details>

          {lage.bewirtschaftung.wert === null ? (
            <div className="meldung" data-art="warnung">
              Ohne Kostenseite gibt es keine Netto-Mietrendite. Entweder
              Belege erfassen oder unten einen Jahresansatz eintragen.{" "}
              <a className="verweis" href="/belege">
                Belege
              </a>
            </div>
          ) : null}
        </>
      ) : null}

      <h3>Zahlen pflegen</h3>
      <p className="hinweis">
        Beträge mit Komma, zum Beispiel 1.234,56. Ein geleertes Feld löscht
        den Wert — bei den Darlehensfeldern heißt leer „unbekannt“ und 0
        „schuldenfrei“, und das sind zwei verschiedene Aussagen.
      </p>

      <div className="feldraster">
        {FELDER.map((f) => (
          <label key={f.name}>
            {f.titel}
            <input
              type={f.art === "datum" ? "date" : "text"}
              inputMode={f.art === "datum" ? undefined : "decimal"}
              value={werte[f.name]}
              placeholder={f.platzhalter}
              disabled={blockiert}
              onChange={(e) =>
                setWerte((w) => ({ ...w, [f.name]: e.target.value }))
              }
            />
            {f.hinweis ? <span className="hinweis">{f.hinweis}</span> : null}
          </label>
        ))}
      </div>

      <div>
        <button onClick={speichern} disabled={!bereit}>
          {busy ? "speichert …" : `Speichern (${anzahl})`}
        </button>{" "}
        {anzahl === 0 && fehlerhaft.length === 0 ? (
          <span className="rueckmeldung">Nichts geändert.</span>
        ) : null}
        {fehlerhaft.map((f) => (
          <span className="rueckmeldung" data-art="fehler" key={f}>
            {f}
          </span>
        ))}
      </div>

      {meldung ? (
        <div className="rueckmeldung" data-art={meldung.art}>
          {meldung.text}
        </div>
      ) : null}
    </section>
  );
}
