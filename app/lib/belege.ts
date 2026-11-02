import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { query } from "./db";
import { vergleichbar } from "./zuordnung";

/**
 * Belege: aus Mailanhängen und aus dem Upload.
 *
 * Ziel ist, dass später zu jeder Bankbewegung ein Beleg liegt. Ein Teil
 * kommt per Mail herein (Handwerkerrechnungen, Versorgerabrechnungen,
 * Bescheide), der größere Teil bei laufender Sanierung aber als
 * Baumarktrechnung, Amazon-Rechnung oder abfotografierte Quittung.
 *
 * Aus dem Text werden Aussteller, Belegnummer, Datum und Betrag gelesen,
 * soweit sie dort stehen. Was nicht sicher erkannt wird, bleibt leer --
 * ein falsch gelesener Betrag in der Buchhaltung ist schlimmer als gar
 * keiner, weil ihn niemand mehr nachrechnet.
 */

export const ABLAGE = process.env.BELEG_ABLAGE ?? "/daten/belege";

const BELEGHAFTE_ENDUNGEN = /\.(pdf|jpe?g|png|tiff?|docx?|xlsx?)$/i;

/** Anhänge, die offensichtlich keine Belege sind. */
const RAUSCHEN =
  /^(image\d+\.(png|jpe?g|gif)|logo\.|signature|smime\.p7s|winmail\.dat)/i;

export function istBelegKandidat(dateiname: string): boolean {
  if (RAUSCHEN.test(dateiname)) return false;
  return BELEGHAFTE_ENDUNGEN.test(dateiname);
}

// ---------------------------------------------------------------------------
// Belegnummer
// ---------------------------------------------------------------------------

/**
 * Amazon-Bestellnummer, NNN-NNNNNNN-NNNNNNN.
 *
 * Das ist der wichtigste Schlüssel, den es in diesen Daten gibt: Die
 * Abbuchung trägt die Bestellnummer wortgleich im Verwendungszweck
 * ("AMAZON PAYMENTS EUROPE S.C.A. 304-6505212-4722745 AMZN Mktp DE ..."),
 * und dieselbe Nummer steht auf der Rechnung. Damit greift Kriterium 1 des
 * Abgleichs (Belegnummer im Verwendungszweck) -- das einzige Kriterium, das
 * ohne Betragsvergleich sicher ist.
 *
 * Das Format ist starr (3-7-7 Ziffern) und mit nichts anderem in diesen
 * Unterlagen zu verwechseln, deshalb steht es an erster Stelle. Die
 * bisherigen Muster erkannten es nicht: Das Datumsmuster verlangt vier
 * Ziffern vor dem Bindestrich, "304" hat drei.
 */
const AMAZON_BESTELLNUMMER = /\b(\d{3}-\d{7}-\d{7})\b/;

/**
 * Sieht wie ein Datum aus und ist deshalb keine Belegnummer.
 *
 * Das allgemeine Muster \d{4,10}-\d{2,6} trifft auch auf "2026-10" aus
 * einem Datum zu. Als Belegnummer gespeichert wäre das gefährlich: Der
 * Abgleich sucht die Nummer ohne Trennzeichen im Verwendungszweck, und
 * "202610" steckt in jeder längeren Referenznummer. Daraus würde ein
 * "sicherer" Treffer auf eine völlig fremde Buchung.
 */
function wirktWieDatum(s: string): boolean {
  const t = s.replace(/\//g, "-");
  if (/^(19|20)\d{2}-(0?[1-9]|1[0-2])$/.test(t)) return true;
  if (/^(19|20)\d{2}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/.test(t)) return true;
  return false;
}

/** Rechnungsnummer aus Dateiname oder Text. */
export function findeBelegnummer(...texte: string[]): string | null {
  const alles = texte.filter(Boolean).join("\n");

  // Eindeutige Formate zuerst, danach die Etiketten-Muster.
  const amazon = alles.match(AMAZON_BESTELLNUMMER);
  if (amazon) return amazon[1];

  const muster = [
    /\b(?:rechnungs?-?(?:nr\.?|nummer)|re-?nr\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]{2,24})/i,
    /\b(RE|AB|ANG|GS)[-\s]?(\d{3,8})\b/,
    /\b(\d{4,10}[-\/]\d{2,6})\b/,
  ];
  for (const m of muster) {
    const t = alles.match(m);
    if (!t) continue;
    const wert = (t[2] ? `${t[1]}-${t[2]}` : t[1]).trim().toUpperCase();
    if (wirktWieDatum(wert)) continue;
    return wert;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aussteller
// ---------------------------------------------------------------------------

interface AusstellerRegel {
  /** Kurz und kanonisch. */
  name: string;
  muster: RegExp;
  /** Zahlungsdienstleister: steht auf vielen Belegen, stellt sie aber nicht aus. */
  nachrangig?: boolean;
}

/**
 * Nur Marken mit einem unverwechselbaren Namensbestandteil.
 *
 * Der Name ist absichtlich kurz: Kriterium 2 des Abgleichs
 * (lib/belegabgleich.ts) zerlegt den Aussteller in Wortteile ab vier
 * Zeichen und sucht sie im Buchungstext. "Amazon" trifft damit auf
 * "AMAZON PAYMENTS EUROPE S.C.A."; "Amazon EU S.à r.l." würde zusätzlich
 * nach "s à r l" suchen und nichts gewinnen.
 *
 * Wer hier fehlt, wird nicht erkannt -- das ist gewollt. Ein geratener
 * Aussteller führt über Kriterium 2 zu einer "sicheren" Fehlbuchung.
 */
const AUSSTELLER: AusstellerRegel[] = [
  { name: "Amazon", muster: /\bamazon\b|\bamzn\b/i },
  { name: "Temu", muster: /\btemu\b/i },
  { name: "OBI", muster: /\bobi\b/i },
  { name: "Bauhaus", muster: /\bbauhaus\b/i },
  { name: "Hornbach", muster: /\bhornbach\b/i },
  { name: "toom", muster: /\btoom\b/i },
  { name: "Hagebau", muster: /\bhagebau(?:markt)?\b/i },
  { name: "IKEA", muster: /\bikea\b/i },
  { name: "eBay", muster: /\bebay\b/i },
  { name: "AliExpress", muster: /\bali\s?express\b/i },
  { name: "Conrad", muster: /\bconrad\s+electronic\b/i },
  { name: "Würth", muster: /\bw(?:ü|ue)rth\b/i },
  { name: "MediaMarkt", muster: /\bmedia[\s-]?markt\b/i },
  { name: "PayPal", muster: /\bpaypal\b/i, nachrangig: true },
  { name: "Klarna", muster: /\bklarna\b/i, nachrangig: true },
];

/**
 * Rechnungssteller, als kurzer kanonischer Name.
 *
 * null, wenn die Marke nicht in der Liste steht oder wenn zwei Marken im
 * selben Beleg vorkommen: Bei einer Marktplatzrechnung stehen Plattform
 * und Händler beide drauf, und wer von beiden die Rechnung stellt, ist
 * damit nicht entschieden. Für Amazon trägt dann die Bestellnummer den
 * Abgleich, und die ist der sicherere Schlüssel.
 */
export function findeAussteller(...texte: string[]): string | null {
  const text = texte.filter(Boolean).join("\n");
  if (!text.trim()) return null;

  const treffer: { name: string; nachrangig: boolean }[] = [];
  for (const r of AUSSTELLER) {
    if (r.muster.test(text)) {
      treffer.push({ name: r.name, nachrangig: r.nachrangig === true });
    }
  }

  const haupt = treffer.filter((t) => !t.nachrangig);
  if (haupt.length === 1) return haupt[0].name;
  if (haupt.length > 1) return null;

  const nach = treffer.filter((t) => t.nachrangig);
  return nach.length === 1 ? nach[0].name : null;
}

// ---------------------------------------------------------------------------
// Betrag
// ---------------------------------------------------------------------------

/**
 * Eine Zahl aus einem Textschnipsel, deutsch (1.234,56) oder englisch
 * (1,234.56).
 *
 * Gibt null zurück, sobald die Schreibweise nicht eindeutig ist. "1.234"
 * kann tausendzweihundertvierunddreißig oder eins Komma zweihundert-
 * vierunddreißig heißen -- in einer Buchhaltung ist der Unterschied das
 * Tausendfache, also wird geschwiegen statt geraten.
 */
export function leseZahl(roh: string): number | null {
  const t = roh.replace(/[\s   ']/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;

  const komma = t.lastIndexOf(",");
  const punkt = t.lastIndexOf(".");
  const dez = Math.max(komma, punkt);

  // Gar kein Trennzeichen: eine ganze Zahl, daran ist nichts zu deuten.
  if (dez === -1) return pruefeBetrag(Number(t));

  const nach = t.slice(dez + 1);
  if (!/^\d{2}$/.test(nach)) return null;

  const vor = t.slice(0, dez);
  const tausender = dez === komma ? "." : ",";
  // Das Dezimaltrennzeichen darf nur einmal vorkommen.
  if (vor.includes(dez === komma ? "," : ".")) return null;

  if (vor.includes(tausender)) {
    const teile = vor.split(tausender);
    if (!/^\d{1,3}$/.test(teile[0])) return null;
    if (!teile.slice(1).every((x) => /^\d{3}$/.test(x))) return null;
  }
  const ganz = vor.split(tausender).join("");
  if (!/^\d+$/.test(ganz)) return null;
  return pruefeBetrag(Number(`${ganz}.${nach}`));
}

function pruefeBetrag(z: number): number | null {
  if (!Number.isFinite(z) || z <= 0) return null;
  // Eine Baumarktrechnung über mehr als eine Million ist kein Betrag,
  // sondern eine falsch gelesene Nummer.
  if (z > 1_000_000) return null;
  return z;
}

interface Etikett {
  rang: 1 | 2;
  muster: RegExp;
}

/**
 * Etiketten, hinter denen ein Betrag stehen kann -- nach Aussagekraft.
 *
 * Rang 1 bezeichnet nur die Endsumme. Rang 2 kann auch über einem
 * Teilbetrag stehen und zählt deshalb erst, wenn kein Rang-1-Etikett im
 * Beleg vorkommt.
 *
 * Vor und hinter dem Etikett darf kein Buchstabe stehen. Genau daran
 * scheitert "Zwischensumme": "summe" hat ein "n" davor. Dasselbe gilt für
 * "Nettosumme", "Teilsumme" und "Gesamtpreis" in der Artikelzeile.
 */
const ETIKETTEN: Etikett[] = [
  {
    rang: 1,
    muster:
      /(?<![a-zäöüß])(?:gesamtsumme|gesamtbetrag|rechnungsbetrag|rechnungssumme|endbetrag|endsumme|zahlbetrag|zu\s+zahlen(?:de[rnms]?)?(?:\s+betrag)?|summe\s+brutto|brutto\s*summe|gesamt\s*brutto|total\s+amount|amount\s+due|amount\s+payable|grand\s+total|invoice\s+total|order\s+total|balance\s+due)(?![a-zäöüß])/gi,
  },
  {
    rang: 2,
    muster:
      /(?<![a-zäöüß])(?:gesamt|bruttobetrag|brutto|summe|total)(?![a-zäöüß])/gi,
  },
];

/**
 * Was zwischen Etikett und Zahl stehen darf, ohne dass die Zahl etwas
 * anderes wird. "netto" und "ohne" kehren die Aussage um, ein Prozent-
 * zeichen gehört zum Steuersatz, "Rabatt" und "Skonto" zu einem Abzug.
 */
const UMDEUTUNG = /netto|ohne|rabatt|skonto|abzug|discount/i;

/**
 * Ein Steuersatz ist kein Betrag.
 *
 * "Gesamtbetrag inkl. 19 % MwSt: 119,00 EUR" -- die erste Zahl hinter dem
 * Etikett ist hier die 19. Sie stand im Weg, bevor es diese Zeile gab, und
 * zwar mit dem schlimmstmöglichen Ergebnis: einem plausiblen, viel zu
 * kleinen Betrag. Prozentangaben werden deshalb aus dem Fenster
 * genommen, bevor darin nach der Zahl gesucht wird.
 */
function ohneProzente(fenster: string): string {
  return fenster.replace(/\d{1,3}(?:[.,]\d{1,2})?\s*%/g, " ");
}

const ZAHL_AM_ANFANG =
  /^(?:\d{1,3}(?:[   ]\d{3})+(?:[.,]\d{2})?|\d[\d.,]*\d|\d)/;

/**
 * Bruttobetrag der Rechnung.
 *
 * Es wird nicht der erste Treffer genommen, sondern das stärkste Etikett
 * und darin das späteste Vorkommen: Summen stehen am Ende, und über einer
 * Zwischensumme steht dasselbe Wort wie über der Endsumme. Findet sich
 * kein Etikett oder keine eindeutig lesbare Zahl, kommt null zurück.
 */
export function findeBetrag(text: string): number | null {
  const kandidaten: { rang: 1 | 2; stelle: number; wert: number }[] = [];

  for (const e of ETIKETTEN) {
    // Jeder Lauf braucht einen frischen lastIndex -- das Muster ist global.
    const muster = new RegExp(e.muster.source, e.muster.flags);
    for (const t of text.matchAll(muster)) {
      const stelle = t.index ?? 0;
      const rest = ohneProzente(
        text.slice(stelle + t[0].length, stelle + t[0].length + 64),
      );
      // Kein Minuszeichen in der Lücke: ein negativer Betrag ist eine
      // Gutschrift und gehört nicht als Bruttobetrag in den Beleg.
      const luecke = rest.match(/^[^\d\n\-]{0,40}/);
      if (!luecke) continue;
      if (UMDEUTUNG.test(luecke[0])) continue;
      const z = rest.slice(luecke[0].length).match(ZAHL_AM_ANFANG);
      if (!z) continue;
      const wert = leseZahl(z[0]);
      if (wert === null) continue;
      kandidaten.push({ rang: e.rang, stelle, wert });
    }
  }

  if (kandidaten.length === 0) return null;
  const besterRang = Math.min(...kandidaten.map((k) => k.rang));
  return kandidaten
    .filter((k) => k.rang === besterRang)
    .reduce((a, b) => (b.stelle > a.stelle ? b : a)).wert;
}

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

function istTag(j: number, m: number, t: number): boolean {
  if (m < 1 || m > 12 || t < 1 || t > 31) return false;
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

function lieseTag(text: string): string | null {
  let m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (m && istTag(+m[3], +m[2], +m[1])) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m && istTag(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * Belegdatum im Format 31.10.2026 oder 2026-10-31.
 *
 * Ein ausdrücklich benanntes Datum geht vor: Auf einer Rechnung steht oft
 * zuerst das Lieferdatum oder ein Leistungszeitraum, und das erste Datum
 * im Text ist dann nicht das Belegdatum. Unmögliche Daten (31.02.) werden
 * verworfen statt zurechtgebogen.
 */
export function findeDatum(text: string): string | null {
  const etikett = text.match(
    /\b(?:rechnungs-?datum|belegdatum|bestelldatum|datum|invoice\s+date|order\s+date|date)\b[^0-9\n]{0,24}([0-9][0-9.\-\/]{7,9})/i,
  );
  if (etikett) {
    const t = lieseTag(etikett[1]);
    if (t) return t;
  }
  return lieseTag(text);
}

// ---------------------------------------------------------------------------
// Auswertung eines Belegs, Stufe 1 (Regelwerk)
// ---------------------------------------------------------------------------

export type BelegFeld = "aussteller" | "belegnummer" | "belegdatum" | "betrag_brutto";

export interface BelegBefund {
  aussteller: string | null;
  belegnummer: string | null;
  belegdatum: string | null;
  betrag_brutto: number | null;
  /** Woher jedes Feld kommt. null heißt: nicht erkannt, bitte eintragen. */
  quelle: Record<BelegFeld, "text" | "modell" | null>;
}

export function leererBefund(): BelegBefund {
  return {
    aussteller: null,
    belegnummer: null,
    belegdatum: null,
    betrag_brutto: null,
    quelle: {
      aussteller: null,
      belegnummer: null,
      belegdatum: null,
      betrag_brutto: null,
    },
  };
}

/**
 * Stufe 1: reines Regelwerk, ohne Netz und ohne Sprachmodell.
 *
 * Das ist der Weg, auf dem die Plattform immer läuft. Stufe 2 ergänzt
 * höchstens, was hier leer geblieben ist.
 */
export function werteBelegAus(text: string, dateiname?: string): BelegBefund {
  const b = leererBefund();
  const alles = [text, dateiname ?? ""].filter(Boolean).join("\n");

  b.aussteller = findeAussteller(alles);
  b.belegnummer = findeBelegnummer(text, dateiname ?? "");
  b.belegdatum = findeDatum(text) ?? (dateiname ? findeDatum(dateiname) : null);
  b.betrag_brutto = findeBetrag(text);

  b.quelle.aussteller = b.aussteller ? "text" : null;
  b.quelle.belegnummer = b.belegnummer ? "text" : null;
  b.quelle.belegdatum = b.belegdatum ? "text" : null;
  b.quelle.betrag_brutto = b.betrag_brutto !== null ? "text" : null;
  return b;
}

// ---------------------------------------------------------------------------
// Stufe 2: Sprachmodell, nur für die Lücken
// ---------------------------------------------------------------------------

/** Was das Modell geliefert hat, auf Plausibilität geprüft. */
export function pruefeModellfelder(roh: unknown): Partial<Record<BelegFeld, string | number>> {
  const aus: Partial<Record<BelegFeld, string | number>> = {};
  if (!roh || typeof roh !== "object") return aus;
  const o = roh as Record<string, unknown>;

  const text = (w: unknown, max: number): string | null => {
    if (typeof w !== "string") return null;
    const s = w.trim();
    if (!s || s.length > max) return null;
    if (/^(unbekannt|unknown|null|n\/a|-)$/i.test(s)) return null;
    return s;
  };

  const a = text(o.aussteller, 60);
  if (a) aus.aussteller = a;

  const n = text(o.belegnummer, 40);
  if (n && /[0-9]/.test(n)) aus.belegnummer = n;

  const d = text(o.belegdatum, 10);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [j, m, t] = d.split("-").map(Number);
    if (istTag(j, m, t) && j >= 2000 && j <= 2100) aus.belegdatum = d;
  }

  // Der Betrag ist das einzige Feld, bei dem ein Modellfehler direkt in
  // die Bücher wandert. Deshalb hier dieselbe strenge Zahlenprüfung wie
  // im Regelwerk -- und nichts anderes.
  const r = o.betrag_brutto;
  const z =
    typeof r === "number"
      ? pruefeBetrag(r)
      : typeof r === "string"
        ? leseZahl(r.trim())
        : null;
  if (z !== null) aus.betrag_brutto = z;

  return aus;
}

/**
 * Stufe 2: Sprachmodell, sobald ANTHROPIC_API_KEY gesetzt ist.
 *
 * Es bekommt nur den bereits extrahierten Text, nie die Datei. Und es darf
 * nur füllen, was Stufe 1 offen gelassen hat -- ein erkannter Betrag wird
 * nicht überschrieben. Ohne Schlüssel, ohne Netz oder bei jeder Art von
 * Fehler bleibt der Befund, wie er war.
 */
export async function ergaenzeMitModell(
  text: string,
  befund: BelegBefund,
): Promise<BelegBefund> {
  const key = process.env.ANTHROPIC_API_KEY;
  const offen = (Object.keys(befund.quelle) as BelegFeld[]).filter(
    (f) => befund.quelle[f] === null,
  );
  if (!key || offen.length === 0) return befund;
  if (text.replace(/\s/g, "").length < 40) return befund;

  const anweisung = `Du liest den Text einer Eingangsrechnung und gibst die fehlenden Stammdaten zurück.

Antworte ausschließlich mit einem JSON-Objekt, ohne Erklärung, mit genau diesen Schlüsseln:
{"aussteller": string|null, "belegnummer": string|null, "belegdatum": "JJJJ-MM-TT"|null, "betrag_brutto": number|null}

Regeln, die du nie brichst:
- Was nicht im Text steht, ist null. Nicht schätzen, nicht ableiten, nicht aus dem Weltwissen ergänzen.
- aussteller: kurzer, gebräuchlicher Name der Firma, die die Rechnung stellt (z. B. "Amazon", "OBI", "Hornbach"). Keine Rechtsform, keine Adresse.
- belegnummer: die Rechnungs- oder Bestellnummer, genau wie im Text geschrieben.
- betrag_brutto: der Endbetrag der Rechnung in Euro, als Zahl mit Punkt als Dezimaltrennzeichen. Keine Zwischensumme, kein Nettobetrag, kein Steuerbetrag.
- Bei Zweifel null.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AGENT_MODELL ?? "claude-sonnet-4-6",
        max_tokens: 400,
        system: anweisung,
        messages: [
          {
            role: "user",
            content: `Fehlende Felder: ${offen.join(", ")}\n\nRechnungstext:\n${text.slice(0, 6000)}`,
          },
        ],
      }),
    });
    if (!res.ok) return befund;
    const d = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const roh = (d.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    const klammer = roh.match(/\{[\s\S]*\}/);
    if (!klammer) return befund;

    const felder = pruefeModellfelder(JSON.parse(klammer[0]));
    const neu: BelegBefund = {
      ...befund,
      quelle: { ...befund.quelle },
    };
    for (const f of offen) {
      const w = felder[f];
      if (w === undefined) continue;
      if (f === "betrag_brutto") neu.betrag_brutto = w as number;
      else neu[f] = String(w);
      neu.quelle[f] = "modell";
    }
    return neu;
  } catch {
    return befund;
  }
}

// ---------------------------------------------------------------------------
// Vorschau: welche Kontobewegung könnte dazu passen?
// ---------------------------------------------------------------------------

export interface BewegungZeile {
  id: string;
  buchungstag: string;
  betrag: string;
  absender: string | null;
  verwendungszweck: string | null;
}

export interface BewegungTreffer {
  buchung_id: string;
  buchungstag: string;
  betrag: string;
  sicherheit: "sicher" | "unsicher";
  begruendung: string;
}

/**
 * Vorschlag für die Vorschau -- nicht maßgeblich.
 *
 * Maßgeblich bleibt lib/belegabgleich.ts, das nach dem Speichern läuft.
 * Diese Funktion spiegelt dessen Reihenfolge (Belegnummer, dann Aussteller
 * samt Betrag, dann Betrag allein), damit vor dem Speichern sichtbar ist,
 * worauf der Beleg zeigt. Sie schreibt nichts.
 */
export function findeKontobewegung(
  befund: BelegBefund,
  bewegungen: BewegungZeile[],
): BewegungTreffer | null {
  const zeile = (b: BewegungZeile, sicherheit: "sicher" | "unsicher", grund: string) => ({
    buchung_id: b.id,
    buchungstag: b.buchungstag,
    betrag: b.betrag,
    sicherheit,
    begruendung: grund,
  });

  if (befund.belegnummer) {
    const nackt = befund.belegnummer.replace(/[\s\-\/]/g, "").toUpperCase();
    const perNummer = bewegungen.filter((b) =>
      `${b.absender ?? ""} ${b.verwendungszweck ?? ""}`
        .toUpperCase()
        .replace(/[\s\-\/]/g, "")
        .includes(nackt),
    );
    if (perNummer.length === 1) {
      return zeile(
        perNummer[0],
        "sicher",
        `Belegnummer ${befund.belegnummer} steht im Verwendungszweck.`,
      );
    }
  }

  const betrag = befund.betrag_brutto;
  if (betrag === null) return null;

  const gleicherBetrag = bewegungen.filter(
    (b) => Math.abs(Math.abs(Number(b.betrag)) - betrag) < 0.005,
  );

  if (befund.aussteller) {
    const teile = vergleichbar(befund.aussteller)
      .split(" ")
      .filter((t) => t.length >= 4);
    const perName = gleicherBetrag.filter((b) => {
      const text = vergleichbar(`${b.absender ?? ""} ${b.verwendungszweck ?? ""}`);
      return teile.length > 0 && teile.some((t) => text.includes(t));
    });
    if (perName.length === 1) {
      return zeile(
        perName[0],
        "sicher",
        "Aussteller erkannt und Betrag stimmt auf den Cent.",
      );
    }
  }

  if (gleicherBetrag.length === 1) {
    return zeile(
      gleicherBetrag[0],
      "unsicher",
      "Nur der Betrag passt — Aussteller und Belegnummer tauchen in der Buchung nicht auf.",
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ablage
// ---------------------------------------------------------------------------

/**
 * Pfad in der Ablage. Der Dateiname ist ein Hash des Inhalts, damit
 * derselbe Beleg aus zwei Quellen nicht zweimal liegt.
 */
export function ablagePfad(daten: Buffer, dateiname: string): string {
  const hash = createHash("sha256").update(daten).digest("hex").slice(0, 24);
  const endung = dateiname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const monat = new Date().toISOString().slice(0, 7);
  return join(ABLAGE, monat, `${hash}${endung}`);
}

export async function legeAb(daten: Buffer, dateiname: string): Promise<string> {
  const pfad = ablagePfad(daten, dateiname);
  await mkdir(join(pfad, ".."), { recursive: true });
  await writeFile(pfad, daten);
  return pfad;
}

export interface AnhangEingang {
  dateiname: string;
  mime_typ?: string | null;
  inhalt_base64: string;
}

export interface BelegErgebnis {
  beleg_id: string | null;
  dateiname: string;
  uebersprungen?: string;
  belegnummer: string | null;
  betrag: number | null;
  aussteller?: string | null;
}

/**
 * Sichert einen Anhang auf der Platte und legt ihn als Beleg an.
 */
export async function sichereAnhang(
  anhang: AnhangEingang,
  bezug: {
    vorgang_id: string;
    nachricht_id: string;
    kontakt_id: string | null;
    betreff: string;
    koerper: string;
  },
): Promise<BelegErgebnis> {
  if (!istBelegKandidat(anhang.dateiname)) {
    return {
      beleg_id: null,
      dateiname: anhang.dateiname,
      uebersprungen: "Kein Belegformat (vermutlich Signaturbild).",
      belegnummer: null,
      betrag: null,
    };
  }

  const daten = Buffer.from(anhang.inhalt_base64, "base64");
  const pfad = await legeAb(daten, anhang.dateiname);

  const suchtext = `${anhang.dateiname}\n${bezug.betreff}\n${bezug.koerper}`;
  const belegnummer = findeBelegnummer(anhang.dateiname, bezug.betreff, bezug.koerper);
  const betrag = findeBetrag(suchtext);
  const datum = findeDatum(bezug.koerper) ?? findeDatum(anhang.dateiname);
  // Der Aussteller stand bisher nicht in der Zeile. Ohne ihn kann
  // Kriterium 2 des Abgleichs (Aussteller plus Betrag) nie greifen --
  // für Mailbelege war es damit praktisch abgeschaltet.
  const aussteller = findeAussteller(suchtext);

  const [a] = await query<{ id: string }>(
    `INSERT INTO anhang (nachricht_id, dateiname, mime_typ, groesse_bytes, ablage_pfad)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [bezug.nachricht_id, anhang.dateiname, anhang.mime_typ ?? null, daten.length, pfad],
  );

  const [b] = await query<{ id: string }>(
    `INSERT INTO beleg (art, richtung, vorgang_id, nachricht_id, anhang_id,
                        kontakt_id, aussteller, belegnummer, belegdatum,
                        betrag_brutto, dateiname, ablage_pfad)
     VALUES ('rechnung','eingang',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      bezug.vorgang_id, bezug.nachricht_id, a.id, bezug.kontakt_id,
      aussteller, belegnummer, datum, betrag, anhang.dateiname, pfad,
    ],
  );

  return {
    beleg_id: b.id,
    dateiname: anhang.dateiname,
    belegnummer,
    betrag,
    aussteller,
  };
}
