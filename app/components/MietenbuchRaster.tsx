import Link from "next/link";
import type {
  Gruppe,
  LeerGrund,
  Raster,
  Summe,
  Zelle,
  ZellStatus,
} from "@/lib/mietenbuch";
import type { Abschnitt } from "@/lib/mietenbuch";

/**
 * Das Mietenbuch als Raster: Zeilen sind Einheiten, Spalten sind Monate.
 *
 * Die Zustände sind doppelt gekennzeichnet -- Farbe UND Zeichen UND Wort.
 * Eine Zelle, die nur rot ist, sagt niemandem etwas, der Rot nicht von Grün
 * unterscheiden kann, und auf einem ausgedruckten Schwarzweissblatt sagt sie
 * gar nichts mehr.
 *
 * Gerechnet wird hier nichts. Jede Zahl und jeder Zustand kommt fertig aus
 * lib/mietenbuch.ts, und der Zahlungsstand dort aus lib/mieter.ts.
 */

const EURO = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});
const ZAHL = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MONAT_KURZ = new Intl.DateTimeFormat("de-DE", { month: "short" });
const MONAT_LANG = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});
const TAG = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const TAG_JAHR = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const alsDatum = (iso: string) => new Date(iso + "T12:00:00Z");
const euro = (n: number) => EURO.format(n);
const zahl = (n: number) => ZAHL.format(n);

type Art = "gut" | "warn" | "fehl" | "still";

interface Kennzeichen {
  zeichen: string;
  kurz: string;
  lang: string;
  art: Art;
}

export const STAND: Record<Exclude<ZellStatus, "leer">, Kennzeichen> = {
  bezahlt: {
    zeichen: "✓",
    kurz: "bezahlt",
    lang: "bezahlt",
    art: "gut",
  },
  teilweise: {
    zeichen: "◐",
    kurz: "teilweise",
    lang: "nur teilweise bezahlt",
    art: "warn",
  },
  offen: {
    zeichen: "✕",
    kurz: "offen",
    lang: "fällig und offen",
    art: "fehl",
  },
  nicht_faellig: {
    zeichen: "·",
    kurz: "n. fällig",
    lang: "noch nicht fällig",
    art: "still",
  },
  nicht_abgeglichen: {
    zeichen: "?",
    kurz: "n. abgegl.",
    lang:
      "nicht abgeglichen — für diesen Monat liegen keine Kontoumsätze vor. " +
      "Das ist kein Rückstand, sondern eine Lücke in den Daten",
    art: "still",
  },
};

export const LEER: Record<LeerGrund, Kennzeichen> = {
  frei: {
    zeichen: "○",
    kurz: "Leerstand",
    lang: "kein Mietverhältnis — Leerstand",
    art: "warn",
  },
  eltern: {
    zeichen: "↳",
    kurz: "über Etage",
    lang:
      "kein eigener Vertrag, aber belegt: die übergeordnete Einheit ist " +
      "als Ganzes vermietet. Kein Leerstand",
    art: "still",
  },
  unbekannt: {
    zeichen: "?",
    kurz: "nicht erfasst",
    lang:
      "kein Mietverhältnis erfasst. Die Belegung dieser Einheit ist nicht " +
      "gepflegt — es kann ein Altmieter darin wohnen. Kein Leerstand",
    art: "still",
  },
  nicht_vermietbar: {
    zeichen: "–",
    kurz: "nicht vermietet",
    lang: "wird nicht vermietet, zählt nicht in die Leerstandsquote",
    art: "still",
  },
};

// ---------------------------------------------------------------------------

function AbschnittInhalt({
  a,
  einheit,
  monat,
}: {
  a: Abschnitt;
  einheit: string;
  monat: string;
}) {
  const k = STAND[a.status];
  const rest = Math.round((a.soll - a.gezahlt) * 100) / 100;

  const titel = [
    `${einheit} · ${MONAT_LANG.format(alsDatum(monat))}`,
    a.kontakt_name,
    a.miete_unbekannt
      ? "keine Miete hinterlegt — es wird nichts behauptet"
      : `Soll ${euro(a.soll)}${a.gezahlt > 0 ? `, zugeordnet ${euro(a.gezahlt)}` : ""}`,
    k.lang,
    rest >= 1 && a.status === "teilweise" ? `Rest ${euro(rest)}` : null,
    a.ab ? `ab ${TAG.format(alsDatum(a.ab))}` : null,
    a.bis ? `bis ${TAG.format(alsDatum(a.bis))}` : null,
    a.quelle === "sollstellung" ? null : "nicht gestellt, Betrag aus dem Vertrag",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/mietverhaeltnis/${a.mietverhaeltnis_id}`}
      className="mb-teil"
      title={titel}
    >
      <span className="mb-soll ziffern">
        {a.miete_unbekannt ? "—" : zahl(a.soll)}
      </span>
      <span className="mb-stand" data-art={k.art}>
        <span aria-hidden="true">{k.zeichen}</span> {k.kurz}
      </span>
      {a.status === "teilweise" && (
        <span className="mb-rest ziffern">davon {zahl(a.gezahlt)}</span>
      )}
      <span className="mb-name">
        {a.kontakt_name}
        {(a.ab || a.bis) && (
          <span className="mb-frist">
            {a.ab ? ` ab ${TAG.format(alsDatum(a.ab))}` : ""}
            {a.bis ? ` bis ${TAG.format(alsDatum(a.bis))}` : ""}
          </span>
        )}
      </span>
    </Link>
  );
}

function ZellInhalt({ z, einheit }: { z: Zelle; einheit: string }) {
  if (z.status === "leer") {
    const k = LEER[z.leer_grund ?? "frei"];
    return (
      <Link
        href={`/einheit/${z.einheit_id}`}
        className="mb-teil"
        title={`${einheit} · ${MONAT_LANG.format(alsDatum(z.monat))} · ${k.lang}`}
      >
        <span className="mb-soll ziffern">—</span>
        <span className="mb-stand" data-art={k.art}>
          <span aria-hidden="true">{k.zeichen}</span> {k.kurz}
        </span>
      </Link>
    );
  }
  return (
    <>
      {z.abschnitte.map((a) => (
        <AbschnittInhalt
          key={a.mietverhaeltnis_id}
          a={a}
          einheit={einheit}
          monat={z.monat}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

/** Die Abweichung mit Vorzeichen. Negativ heisst: es fehlt etwas. */
function Abweichung({ s }: { s: Summe }) {
  const art = s.abweichung <= -1 ? "fehl" : s.abweichung >= 1 ? "warn" : "gut";
  const nicht = s.soll_ohne_daten + s.soll_nicht_faellig;
  const titel =
    nicht >= 1
      ? `Nicht in die Abweichung gerechnet: ${euro(s.soll_ohne_daten)} aus ` +
        `Monaten ohne Kontodaten und ${euro(s.soll_nicht_faellig)} aus noch ` +
        "nicht fälligen Monaten."
      : "Verglichen werden nur fällige Monate mit Kontodaten.";
  return (
    <span className="mb-abw" data-art={art} title={titel}>
      {s.abweichung > 0 ? "+" : ""}
      {zahl(s.abweichung)}
      {nicht >= 1 && <span aria-hidden="true"> *</span>}
    </span>
  );
}

function quote(s: Summe): string {
  if (s.leerstandsquote === null) return "—";
  return `${(s.leerstandsquote * 100).toLocaleString("de-DE", {
    maximumFractionDigits: 0,
  })} %`;
}

/** Die vier Summenzeilen unter einem Objekt oder unter dem ganzen Buch. */
function SummenZeilen({
  titel,
  spalten,
  gesamt,
  kaution,
}: {
  titel: string;
  spalten: Summe[];
  gesamt: Summe;
  kaution: number | null;
}) {
  const zeilen: Array<{
    name: string;
    wert: (s: Summe) => React.ReactNode;
    gesamtWert: React.ReactNode;
  }> = [
    {
      name: "Soll",
      wert: (s) => <span className="ziffern">{zahl(s.soll)}</span>,
      gesamtWert: <span className="ziffern">{zahl(gesamt.soll)}</span>,
    },
    {
      name: "Ist",
      wert: (s) => <span className="ziffern">{zahl(s.ist)}</span>,
      gesamtWert: <span className="ziffern">{zahl(gesamt.ist)}</span>,
    },
    {
      name: "Abweichung",
      wert: (s) => <Abweichung s={s} />,
      gesamtWert: <Abweichung s={gesamt} />,
    },
    {
      name: "Leerstand",
      wert: (s) => <span className="ziffern">{quote(s)}</span>,
      gesamtWert: <span className="ziffern">{quote(gesamt)}</span>,
    },
  ];

  return (
    <>
      {zeilen.map((z, i) => (
        <tr key={z.name} className="mb-summe">
          <th scope="row" className="mb-einheit">
            {i === 0 ? <strong>{titel}</strong> : <span className="mb-leise">{titel}</span>}
            <span className="mb-unter">{z.name}</span>
          </th>
          {spalten.map((s, j) => (
            <td key={j} className="betrag mb-summenzelle">
              {z.wert(s)}
            </td>
          ))}
          <td className="betrag mb-summenzelle">{z.gesamtWert}</td>
          {/* Die beiden letzten Spalten stehen für den ganzen Zeitraum und
              nicht je Summenzeile — sie werden einmal ausgefüllt und reichen
              über die vier Zeilen hinweg. */}
          {i === 0 && (
            <>
              <td className="betrag mb-summenzelle" rowSpan={4}>
                <span className="ziffern">{zahl(gesamt.kaltmiete)}</span>
                <span className="mb-unter ziffern">
                  BK {zahl(gesamt.nebenkosten)}
                </span>
                {gesamt.nicht_aufgeteilt !== 0 && (
                  <span
                    className="mb-unter ziffern"
                    title="Soll ohne Aufteilung in Kaltmiete und Betriebskosten: Inklusivmieten, Möblierungszuschläge und anteilige Monate."
                  >
                    o. A. {zahl(gesamt.nicht_aufgeteilt)}
                  </span>
                )}
              </td>
              <td className="betrag mb-summenzelle" rowSpan={4}>
                <span className="ziffern">
                  {kaution === null ? "—" : zahl(kaution)}
                </span>
              </td>
            </>
          )}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

function ObjektBlock({
  g,
  monate,
  laufend,
}: {
  g: Gruppe;
  monate: string[];
  laufend: string;
}) {
  const spannweite = monate.length + 4;
  const kautionen = g.zeilen.reduce((s, z) => s + (z.kaution ?? 0), 0);

  return (
    <tbody>
      <tr className="mb-gruppe">
        <th scope="colgroup" colSpan={spannweite}>
          {g.objekt_name}
          <span className="mb-leise">
            {" · "}
            {g.zeilen.length} {g.zeilen.length === 1 ? "Einheit" : "Einheiten"}
            {g.zahlungsdaten_ab
              ? ` · Kontodaten ab ${TAG_JAHR.format(alsDatum(g.zahlungsdaten_ab))}`
              : " · keine Kontodaten — hier wird nichts abgeglichen und nicht gemahnt"}
          </span>
        </th>
      </tr>

      {g.zeilen.map((z) => (
        <tr key={z.einheit.id}>
          <th scope="row" className="mb-einheit">
            <Link href={`/einheit/${z.einheit.id}`}>{z.bezeichnung}</Link>
            {z.untertitel && <span className="mb-unter">{z.untertitel}</span>}
          </th>
          {z.zellen.map((c) => (
            <td
              key={c.monat}
              className="mb-zelle"
              data-status={c.status}
              data-grund={c.leer_grund ?? undefined}
              data-jetzt={c.monat === laufend ? "ja" : undefined}
            >
              <ZellInhalt z={c} einheit={z.bezeichnung} />
            </td>
          ))}
          <td className="betrag mb-zeilensumme">
            <span className="ziffern">{zahl(z.summe.soll)}</span>
            <span className="mb-unter ziffern">Ist {zahl(z.summe.ist)}</span>
            <Abweichung s={z.summe} />
          </td>
          <td className="betrag mb-zeilensumme">
            <span className="ziffern">{zahl(z.summe.kaltmiete)}</span>
            <span className="mb-unter ziffern">
              BK {zahl(z.summe.nebenkosten)}
            </span>
            {z.summe.nicht_aufgeteilt !== 0 && (
              <span
                className="mb-unter ziffern"
                title="Soll ohne Aufteilung: Inklusivmiete, Möblierungszuschlag oder anteiliger Monat."
              >
                o. A. {zahl(z.summe.nicht_aufgeteilt)}
              </span>
            )}
          </td>
          <td className="betrag mb-zeilensumme">
            <span className="ziffern">
              {z.kaution === null ? "—" : zahl(z.kaution)}
            </span>
          </td>
        </tr>
      ))}

      <SummenZeilen
        titel={g.objekt_name}
        spalten={g.spalten}
        gesamt={g.summe}
        kaution={kautionen}
      />
    </tbody>
  );
}

export function MietenbuchRaster({
  raster,
  laufend,
}: {
  raster: Raster;
  laufend: string;
}) {
  const { monate, gruppen } = raster;
  const kautionen = gruppen
    .flatMap((g) => g.zeilen)
    .reduce((s, z) => s + (z.kaution ?? 0), 0);

  return (
    <>
      <style>{RASTER_CSS}</style>
      <div className="tabelle-rolle">
        <table className="mb-raster">
          <thead>
            <tr>
              <th rowSpan={2} className="mb-einheit mb-kopf">
                Einheit
              </th>
              <th colSpan={monate.length} className="mb-mitte">
                Monate — Soll, Zustand, Mieter
              </th>
              <th colSpan={3} className="mb-mitte">
                Zeitraum gesamt
              </th>
            </tr>
            <tr>
              {monate.map((m) => (
                <th
                  key={m}
                  className="betrag mb-monat"
                  data-jetzt={m === laufend ? "ja" : undefined}
                  scope="col"
                >
                  <span>{MONAT_KURZ.format(alsDatum(m))}</span>
                  <span className="mb-unter ziffern">{m.slice(0, 4)}</span>
                </th>
              ))}
              <th className="betrag" scope="col">
                Soll / Ist / Abw.
              </th>
              <th className="betrag" scope="col">
                Kalt / BK
              </th>
              <th className="betrag" scope="col">
                Kaution
              </th>
            </tr>
          </thead>

          {gruppen.map((g) => (
            <ObjektBlock
              key={g.objekt_id}
              g={g}
              monate={monate}
              laufend={laufend}
            />
          ))}

          {gruppen.length > 1 && (
            <tfoot>
              <SummenZeilen
                titel="Alle Objekte"
                spalten={raster.spalten}
                gesamt={raster.summe}
                kaution={kautionen}
              />
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

/**
 * Nur das, was dieses Raster braucht und keine andere Seite: die klebende
 * erste Spalte und der Aufbau einer Zelle. Die Farben und Abstände kommen
 * aus den Marken in globals.css -- diese Datei legt keine eigenen fest.
 */
const RASTER_CSS = `
.mb-raster { font-size: var(--text-s); }
.mb-raster th,
.mb-raster td { padding: 0.375rem 0.5rem; }

/* Die Einheitenspalte bleibt stehen, während die Monate durchlaufen. */
.mb-raster .mb-einheit {
  position: sticky;
  left: 0;
  z-index: 3;
  text-align: left;
  min-width: 9.5rem;
  max-width: 11rem;
  background: var(--flaeche-tief);
  border-right: 1px solid var(--linie-stark);
  vertical-align: top;
  white-space: normal;
  font-weight: 600;
  color: var(--fg);
}
.mb-raster thead .mb-einheit { z-index: 4; }
.mb-raster .mb-einheit a { color: var(--fg); }
.mb-raster .mb-einheit a:hover { color: var(--akzent); text-decoration: underline; }

.mb-raster .mb-mitte { text-align: center; }
.mb-raster .mb-monat { min-width: 5.5rem; text-align: right; }
.mb-raster .mb-monat[data-jetzt="ja"] { color: var(--akzent); }

.mb-unter {
  display: block;
  font-weight: 400;
  font-size: var(--text-xs);
  color: var(--fg-leise);
}
.mb-leise { color: var(--fg-leise); font-weight: 400; }

/* --- Gruppenkopf --------------------------------------------------------- */
.mb-raster .mb-gruppe th {
  position: sticky;
  left: 0;
  text-align: left;
  font-size: var(--text-m);
  color: var(--fg);
  background: var(--akzent-flaeche);
  border-top: 1px solid var(--linie-stark);
  border-bottom: 1px solid var(--linie-stark);
}

/* --- Zelle --------------------------------------------------------------- */
.mb-raster .mb-zelle {
  text-align: right;
  vertical-align: top;
  border-left: 1px solid var(--linie);
}
.mb-raster .mb-zelle[data-jetzt="ja"] { box-shadow: inset 2px 0 0 var(--akzent); }

.mb-teil {
  display: block;
  padding: 0.0625rem 0;
}
.mb-teil + .mb-teil {
  border-top: 1px dashed var(--linie-stark);
  margin-top: 0.1875rem;
  padding-top: 0.1875rem;
}
.mb-teil:hover .mb-soll { text-decoration: underline; }

.mb-soll {
  display: block;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--fg);
}
.mb-stand,
.mb-abw {
  display: block;
  font-size: var(--text-xs);
  white-space: nowrap;
}
.mb-rest {
  display: block;
  font-size: var(--text-xs);
  color: var(--fg-leise);
  font-variant-numeric: tabular-nums;
}
.mb-stand[data-art="gut"]   { color: var(--gut); }
.mb-stand[data-art="warn"]  { color: var(--warn); }
.mb-stand[data-art="fehl"]  { color: var(--fehl); font-weight: 600; }
.mb-stand[data-art="still"] { color: var(--fg-still); }

.mb-name {
  display: block;
  font-size: var(--text-xs);
  color: var(--fg-leise);
  font-weight: 400;
  max-width: 6.5rem;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-frist { color: var(--fg-still); }

/* Flächen je Zustand. Zusätzlich zum Zeichen und zum Wort, nie allein. */
.mb-raster .mb-zelle[data-status="offen"]     { background: var(--fehl-flaeche); }
.mb-raster .mb-zelle[data-status="teilweise"] { background: var(--warn-flaeche); }
.mb-raster .mb-zelle[data-status="bezahlt"]   { background: var(--gut-flaeche); }
.mb-raster .mb-zelle[data-grund="frei"] {
  background: repeating-linear-gradient(
    135deg,
    var(--flaeche-ruhig) 0 6px,
    var(--flaeche-tief) 6px 12px
  );
}

/* --- Summen -------------------------------------------------------------- */
.mb-raster .mb-zeilensumme,
.mb-raster .mb-summenzelle {
  background: var(--flaeche-ruhig);
  border-left: 1px solid var(--linie-stark);
  vertical-align: top;
}
.mb-raster .mb-summe > th,
.mb-raster .mb-summe > td {
  background: var(--flaeche-tief);
  border-top: 1px solid var(--linie-stark);
}
.mb-abw[data-art="fehl"] { color: var(--fehl); font-weight: 600; }
.mb-abw[data-art="warn"] { color: var(--warn); }
.mb-abw[data-art="gut"]  { color: var(--fg-leise); }

@media (max-width: 40rem) {
  .mb-raster .mb-einheit { min-width: 7.5rem; max-width: 8.5rem; }
  .mb-raster .mb-monat { min-width: 5rem; }
  .mb-name { max-width: 5rem; }
}
`;
