import { query } from "./db";
import { KOSTENARTEN } from "./kostenarten";

/**
 * Das Paket für den Steuerberater.
 *
 * WAS ES LEISTEN MUSS
 *
 * Es soll übergabefähig sein, also: Der Steuerberater öffnet es, liest
 * die LIESMICH, und danach prüft er -- er sortiert nicht, er sucht nicht,
 * und er ruft nicht an, um zu fragen, was eine Spalte bedeutet.
 *
 * Daraus folgen vier Entscheidungen:
 *
 * 1. **Lückenlos heisst: auch die Lücken stehen drin.** Ein Journal, aus
 *    dem die Bewegungen ohne Beleg herausgefiltert sind, sieht sauber aus
 *    und ist eine Täuschung. Jede Bewegung des Jahres erscheint, mit
 *    laufender Nummer, und was keinen Beleg hat, steht zusätzlich in
 *    einer eigenen Datei -- zählbar.
 *
 * 2. **Einnahmen und Werbungskosten getrennt.** § 21 EStG rechnet die
 *    beiden gegeneinander; eine Liste, in der sie sich mischen, muss er
 *    erst auseinandernehmen.
 *
 * 3. **Die Belegnummer im Paket ist die Brücke.** Jeder Beleg bekommt
 *    eine laufende Nummer, die im Dateinamen steht und im Journal. Ohne
 *    diese Brücke ist eine Anlage mit 300 PDFs nur ein Haufen.
 *
 * 4. **Nichts wird als entschieden dargestellt, was vorgeschlagen ist.**
 *    Kostenart und Umlagefähigkeit sind Vorschläge, Anlagegut ist ein
 *    Kennzeichen, kein Urteil. Die Spalten heissen so, und die LIESMICH
 *    sagt es noch einmal. Ein Vorschlag, der wie eine Festlegung
 *    aussieht, ist die unangenehmste Art von Fehler: Er wird übernommen.
 *
 * WARUM CSV MIT SEMIKOLON UND BOM
 *
 * Das geht in Excel, und zwar in der deutschen Fassung ohne
 * Importdialog: Semikolon als Trenner, Komma als Dezimalzeichen,
 * UTF-8 mit Bytemarke. Ohne die Marke werden aus Umlauten Zeichenfolgen,
 * und das erste, was der Steuerberater sieht, ist "GieÃŸen".
 */

export interface JournalZeile {
  nr: number;
  buchungstag: string;
  konto: string;
  betrag: string;
  partner: string | null;
  verwendungszweck: string | null;
  beleg_nr: number | null;
  beleg_datei: string | null;
  aussteller: string | null;
  belegnummer: string | null;
  belegdatum: string | null;
  belegbetrag: string | null;
  kostenart: string | null;
  umlagefaehig: boolean | null;
  anlagegut: boolean | null;
  objekt: string | null;
  abweichung: string | null;
  belegfrei_vermerk: string | null;
}

export interface BelegDatei {
  nr: number;
  beleg_id: string;
  ablage_pfad: string;
  dateiname: string;
  aussteller: string | null;
  belegdatum: string | null;
}

export interface Paket {
  jahr: number;
  zeilen: JournalZeile[];
  belege: BelegDatei[];
}

const BOM = "﻿";

function kostenartText(s: string | null): string {
  if (!s) return "";
  return KOSTENARTEN.find((k) => k.schluessel === s)?.text ?? s;
}

function jaNein(w: boolean | null): string {
  return w === true ? "ja" : w === false ? "nein" : "ungeklärt";
}

/** Betrag deutsch: Komma als Dezimalzeichen, kein Tausenderpunkt. */
export function betragDe(w: string | number | null): string {
  if (w === null || w === "") return "";
  const n = typeof w === "number" ? w : Number(w);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2).replace(".", ",");
}

/**
 * Ein CSV-Feld.
 *
 * Eingerahmt wird, sobald Semikolon, Anführungszeichen oder Zeilenumbruch
 * vorkommen -- ein Verwendungszweck enthält beides regelmässig. Ohne das
 * verschiebt sich eine einzige Zeile und danach alle folgenden Spalten,
 * und das fällt in 600 Zeilen niemandem auf.
 */
export function feld(w: string | number | null | undefined): string {
  if (w === null || w === undefined) return "";
  const s = String(w);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(kopf: string[], zeilen: Array<Array<string | number | null>>): string {
  const z = [kopf.map(feld).join(";")];
  for (const r of zeilen) z.push(r.map(feld).join(";"));
  return BOM + z.join("\r\n") + "\r\n";
}

/** Alle Bewegungen eines Jahres, mit dem zugeordneten Beleg. */
export async function ladeJournal(jahr: number): Promise<Paket> {
  const roh = await query<{
    buchung_id: string;
    buchungstag: string;
    konto: string;
    betrag: string;
    partner: string | null;
    verwendungszweck: string | null;
    belegfrei: boolean;
    belegfrei_vermerk: string | null;
    beleg_id: string | null;
    ablage_pfad: string | null;
    dateiname: string | null;
    aussteller: string | null;
    belegnummer: string | null;
    belegdatum: string | null;
    belegbetrag: string | null;
    kostenart: string | null;
    umlagefaehig: boolean | null;
    anlagegut: boolean | null;
    objekt: string | null;
    abweichung: string | null;
  }>(
    `
    SELECT b.id                AS buchung_id,
           b.buchungstag::text AS buchungstag,
           k.bezeichnung       AS konto,
           b.betrag::text      AS betrag,
           b.absender          AS partner,
           b.verwendungszweck,
           b.beleg_nicht_noetig AS belegfrei,
           b.beleg_vermerk      AS belegfrei_vermerk,
           bg.id               AS beleg_id,
           bg.ablage_pfad, bg.dateiname, bg.aussteller, bg.belegnummer,
           bg.belegdatum::text AS belegdatum,
           bg.betrag_brutto::text AS belegbetrag,
           bg.kostenart, bg.umlagefaehig, bg.anlagegut, bg.abweichung,
           o.name              AS objekt
      FROM buchung b
      JOIN konto k           ON k.id = b.konto_id
      LEFT JOIN belegbuchung bb ON bb.buchung_id = b.id
      LEFT JOIN beleg bg        ON bg.id = bb.beleg_id
      LEFT JOIN objekt o        ON o.id = bg.objekt_id
     WHERE date_part('year', b.buchungstag) = $1
     ORDER BY b.buchungstag, b.id, bg.belegdatum NULLS LAST
  `,
    [jahr],
  );

  // Belege durchnummerieren -- einmal je Beleg, auch wenn er an mehreren
  // Bewegungen hängt (Teilzahlungen). Die Nummer ist die Brücke zwischen
  // Journal und Anlage und darf sich nicht doppeln.
  const nummern = new Map<string, number>();
  const belege: BelegDatei[] = [];
  for (const r of roh) {
    if (r.beleg_id && r.ablage_pfad && !nummern.has(r.beleg_id)) {
      const nr = nummern.size + 1;
      nummern.set(r.beleg_id, nr);
      belege.push({
        nr,
        beleg_id: r.beleg_id,
        ablage_pfad: r.ablage_pfad,
        dateiname: r.dateiname ?? `beleg-${nr}`,
        aussteller: r.aussteller,
        belegdatum: r.belegdatum,
      });
    }
  }

  const zeilen: JournalZeile[] = roh.map((r, i) => ({
    nr: i + 1,
    buchungstag: r.buchungstag,
    konto: r.konto,
    betrag: r.betrag,
    partner: r.partner,
    verwendungszweck: r.verwendungszweck,
    beleg_nr: r.beleg_id ? (nummern.get(r.beleg_id) ?? null) : null,
    beleg_datei: r.beleg_id ? belegName(nummern.get(r.beleg_id)!, r.dateiname) : null,
    aussteller: r.aussteller,
    belegnummer: r.belegnummer,
    belegdatum: r.belegdatum,
    belegbetrag: r.belegbetrag,
    kostenart: r.kostenart,
    umlagefaehig: r.umlagefaehig,
    anlagegut: r.anlagegut,
    objekt: r.objekt,
    abweichung: r.abweichung,
    belegfrei_vermerk: r.belegfrei ? (r.belegfrei_vermerk ?? "als belegfrei vermerkt") : null,
  }));

  return { jahr, zeilen, belege };
}

/**
 * Der Name eines Belegs in der Anlage.
 *
 * Führende Nummer, danach der ursprüngliche Name, bereinigt. Nichts
 * anderes als Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich --
 * ein Dateiname in einem Archiv, das jemand anderes auspackt, ist kein
 * Ort für Schrägstriche oder Steuerzeichen.
 */
export function belegName(nr: number, dateiname: string | null): string {
  const roh = (dateiname ?? "beleg").split(/[\\/]/).pop() ?? "beleg";
  const sauber = roh
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return `${String(nr).padStart(4, "0")}_${sauber || "beleg"}`;
}

const JOURNAL_KOPF = [
  "Nr",
  "Buchungstag",
  "Konto",
  "Betrag",
  "Zahlungspartner",
  "Verwendungszweck",
  "Beleg-Nr im Paket",
  "Belegdatei",
  "Aussteller",
  "Belegnummer",
  "Belegdatum",
  "Belegbetrag",
  "Kostenart (Vorschlag)",
  "umlagefähig (Vorschlag)",
  "Anlagegut (Kennzeichen)",
  "Objekt",
  "Hinweis",
];

function journalZeile(z: JournalZeile): Array<string | number | null> {
  const hinweis = [
    z.abweichung ? `Abweichung beim Auslesen: ${z.abweichung}` : null,
    z.belegfrei_vermerk,
    !z.beleg_nr && !z.belegfrei_vermerk ? "kein Beleg zugeordnet" : null,
  ]
    .filter(Boolean)
    .join(" | ");
  return [
    z.nr,
    z.buchungstag,
    z.konto,
    betragDe(z.betrag),
    z.partner,
    z.verwendungszweck,
    z.beleg_nr,
    z.beleg_datei,
    z.aussteller,
    z.belegnummer,
    z.belegdatum,
    betragDe(z.belegbetrag),
    kostenartText(z.kostenart),
    z.kostenart || z.umlagefaehig !== null ? jaNein(z.umlagefaehig) : "",
    z.anlagegut === null ? "" : jaNein(z.anlagegut),
    z.objekt,
    hinweis,
  ];
}

export function journalCsv(p: Paket): string {
  return csv(JOURNAL_KOPF, p.zeilen.map(journalZeile));
}

export function einnahmenCsv(p: Paket): string {
  return csv(
    JOURNAL_KOPF,
    p.zeilen.filter((z) => Number(z.betrag) > 0).map(journalZeile),
  );
}

export function ausgabenCsv(p: Paket): string {
  return csv(
    JOURNAL_KOPF,
    p.zeilen.filter((z) => Number(z.betrag) < 0).map(journalZeile),
  );
}

export function ohneBelegCsv(p: Paket): string {
  return csv(
    ["Nr", "Buchungstag", "Konto", "Betrag", "Zahlungspartner", "Verwendungszweck", "Hinweis"],
    p.zeilen
      .filter((z) => Number(z.betrag) < 0 && !z.beleg_nr && !z.belegfrei_vermerk)
      .map((z) => [
        z.nr,
        z.buchungstag,
        z.konto,
        betragDe(z.betrag),
        z.partner,
        z.verwendungszweck,
        "Beleg fehlt",
      ]),
  );
}

export function anlagegueterCsv(p: Paket): string {
  return csv(
    ["Beleg-Nr im Paket", "Belegdatei", "Belegdatum", "Aussteller", "Betrag", "Objekt", "Kostenart (Vorschlag)"],
    p.zeilen
      .filter((z) => z.anlagegut === true)
      .map((z) => [
        z.beleg_nr,
        z.beleg_datei,
        z.belegdatum,
        z.aussteller,
        betragDe(z.belegbetrag),
        z.objekt,
        kostenartText(z.kostenart),
      ]),
  );
}

/** Summen je Kostenart und Objekt -- die Seite, die er zuerst ansieht. */
export function summenCsv(p: Paket): string {
  const eimer = new Map<string, { objekt: string; art: string; n: number; summe: number }>();
  for (const z of p.zeilen) {
    const betrag = Number(z.betrag);
    if (!Number.isFinite(betrag) || betrag >= 0) continue;
    const objekt = z.objekt ?? "ohne Objektzuordnung";
    const art = z.kostenart ? kostenartText(z.kostenart) : "ohne Kostenart";
    const schluessel = `${objekt}\u0000${art}`;
    const e = eimer.get(schluessel) ?? { objekt, art, n: 0, summe: 0 };
    e.n += 1;
    e.summe += Math.abs(betrag);
    eimer.set(schluessel, e);
  }
  const zeilen = [...eimer.values()]
    .sort((a, b) => a.objekt.localeCompare(b.objekt) || b.summe - a.summe)
    .map((e) => [e.objekt, e.art, e.n, betragDe(e.summe)]);
  return csv(["Objekt", "Kostenart (Vorschlag)", "Bewegungen", "Summe"], zeilen);
}

export interface PaketZahlen {
  bewegungen: number;
  einnahmen: number;
  ausgaben: number;
  mit_beleg: number;
  ohne_beleg: number;
  belegfrei: number;
  mit_abweichung: number;
  belege: number;
}

export function zahlen(p: Paket): PaketZahlen {
  const ausgaben = p.zeilen.filter((z) => Number(z.betrag) < 0);
  return {
    bewegungen: p.zeilen.length,
    einnahmen: p.zeilen
      .filter((z) => Number(z.betrag) > 0)
      .reduce((s, z) => s + Number(z.betrag), 0),
    ausgaben: ausgaben.reduce((s, z) => s + Math.abs(Number(z.betrag)), 0),
    mit_beleg: ausgaben.filter((z) => z.beleg_nr).length,
    ohne_beleg: ausgaben.filter((z) => !z.beleg_nr && !z.belegfrei_vermerk).length,
    belegfrei: ausgaben.filter((z) => z.belegfrei_vermerk).length,
    mit_abweichung: p.zeilen.filter((z) => z.abweichung).length,
    belege: p.belege.length,
  };
}

/**
 * Die LIESMICH.
 *
 * Sie nennt zuerst, was NICHT geprüft ist. Ein Paket, dessen Begleittext
 * mit seinen Stärken anfängt, lädt dazu ein, die Schwächen zu überlesen
 * -- und die Schwächen sind genau das, wofür der Steuerberater bezahlt
 * wird.
 */
export function liesmich(p: Paket, erstellt: Date): string {
  const z = zahlen(p);
  const d = erstellt.toISOString().slice(0, 16).replace("T", " ");
  return `BELEGE UND KONTOBEWEGUNGEN ${p.jahr}
STIG Immobilien eGbR
Erstellt am ${d} aus der Verwaltungsplattform.

WAS SIE PRÜFEN MÜSSEN
---------------------

Die Spalten "Kostenart (Vorschlag)" und "umlagefähig (Vorschlag)" sind
maschinell vorbelegt. Sie sind Vorschläge, keine Festlegungen. Die
Umlagefähigkeit folgt dem Katalog des § 2 BetrKV; ob sie im Einzelfall
greift, hängt am Mietvertrag (§ 556 Abs. 1 BGB) und ist nicht geprüft.

Die Spalte "Anlagegut (Kennzeichen)" markiert Anschaffungen, bei denen
sich die Frage nach Abschreibung oder Sofortabzug stellt. Die Antwort
steht nicht darin. Die betroffenen Belege stehen zusätzlich in
anlagegueter-${p.jahr}.csv.

Wo "Abweichung beim Auslesen" in der Spalte Hinweis steht, haben zwei
unabhängige Auswertungen desselben Belegs verschiedene Beträge oder Daten
ergeben. Diese Zeilen sind nicht automatisch zugeordnet worden und
brauchen einen Blick in den Beleg selbst.

${z.ohne_beleg} Ausgabenbewegungen haben keinen Beleg. Sie stehen
vollständig in ohne-beleg-${p.jahr}.csv. Sie sind nicht herausgefiltert,
sondern ausgewiesen.

ZAHLEN
------

Bewegungen im Jahr            ${z.bewegungen}
  Einnahmen                   ${betragDe(z.einnahmen)} EUR
  Ausgaben                    ${betragDe(z.ausgaben)} EUR
Ausgabenbewegungen mit Beleg  ${z.mit_beleg}
  ohne Beleg                  ${z.ohne_beleg}
  als belegfrei vermerkt      ${z.belegfrei}
Zeilen mit Abweichung         ${z.mit_abweichung}
Einzelbelege in der Anlage    ${z.belege}

WAS IM PAKET LIEGT
------------------

journal-${p.jahr}.csv          jede Bewegung des Jahres, lückenlos
                               durchnummeriert
einnahmen-${p.jahr}.csv        nur die Zugänge
ausgaben-${p.jahr}.csv         nur die Abgänge
summen-${p.jahr}.csv           Summen je Objekt und Kostenart
ohne-beleg-${p.jahr}.csv       Ausgaben ohne Beleg
anlagegueter-${p.jahr}.csv     gekennzeichnete Anschaffungen
belege/                        jeder Einzelbeleg, benannt nach der
                               Spalte "Beleg-Nr im Paket"

Die CSV-Dateien sind mit Semikolon getrennt und UTF-8 mit Bytemarke --
sie öffnen in Excel ohne Importdialog. Dezimaltrennzeichen ist das Komma.

Die Nummer im Dateinamen eines Belegs ist dieselbe wie in der Spalte
"Beleg-Nr im Paket". Ein Beleg, der an mehreren Bewegungen hängt
(Teilzahlung), trägt dieselbe Nummer in jeder dieser Zeilen.
`;
}
