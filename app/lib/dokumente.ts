import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { createHash } from "node:crypto";
import { query, one } from "./db";
import { ABLAGE } from "./belege";

/**
 * Dokumente an Objekt, Einheit und Mietverhältnis.
 *
 * Der Anlass: Zu einer Wohnung gab es bisher nichts anzusehen. Kein Bild,
 * keinen Grundriss, nichts. Die Grundrisse liegen in einem Ordner auf einem
 * Rechner, und wer wissen will, wie ein Zimmer geschnitten ist, fragt nach.
 *
 * Hier stehen die Teile, die ohne Datenbank prüfbar sind -- und das ist
 * Absicht: Es sind genau die Teile, bei denen ein Fehler teuer wird.
 *
 *   erkenneTyp / pruefeDatei  Welche Datei darf herein? Entschieden wird am
 *                             INHALT. Die Endung ist eine Behauptung des
 *                             Hochladenden, nicht eine Eigenschaft der Datei.
 *   sichererDateiname         Ein Dateiname aus dem Netz ist Text, kein Pfad.
 *   ablagePfad                Der Pfad entsteht aus Hash und Endung, nie aus
 *                             einer Eingabe.
 *   darfSehen                 Die zweite Grenze neben RLS: Welcher Mieter
 *                             darf welches Dokument sehen.
 *
 * Tests dazu in tests/dokumente.test.ts.
 */

// ---------------------------------------------------------------------------
// Arten
// ---------------------------------------------------------------------------

export const DOKUMENTARTEN = [
  "grundriss",
  "foto",
  "mietvertrag",
  "uebergabeprotokoll",
  "energieausweis",
  "sonstige",
] as const;

export type Dokumentart = (typeof DOKUMENTARTEN)[number];

export const ART_LABEL: Record<Dokumentart, string> = {
  grundriss: "Grundriss",
  foto: "Foto",
  mietvertrag: "Mietvertrag",
  uebergabeprotokoll: "Übergabeprotokoll",
  energieausweis: "Energieausweis",
  sonstige: "Sonstiges",
};

export function istArt(wert: string): wert is Dokumentart {
  return (DOKUMENTARTEN as readonly string[]).includes(wert);
}

// ---------------------------------------------------------------------------
// Welche Datei darf herein
// ---------------------------------------------------------------------------

/**
 * 25 MB je Datei.
 *
 * Nicht willkürlich: Ein Grundriss als PDF aus dem Architektenprogramm
 * liegt bei 1-5 MB, ein Foto aus dem Telefon bei 3-8 MB. Wer 25 MB
 * überschreitet, lädt ein Video hoch oder einen Scan in 1200 dpi -- in
 * beiden Fällen ist eine Rückmeldung besser als ein Server, der die Datei
 * annimmt und daran die Platte füllt.
 */
export const GRENZE_BYTES = 25 * 1024 * 1024;

export const ERLAUBTE_TYPEN = [
  { mime: "application/pdf", endung: ".pdf", name: "PDF" },
  { mime: "image/png", endung: ".png", name: "PNG" },
  { mime: "image/jpeg", endung: ".jpg", name: "JPEG" },
  { mime: "image/heic", endung: ".heic", name: "HEIC" },
] as const;

const ERLAUBTE_ENDUNGEN: Set<string> = new Set(
  ERLAUBTE_TYPEN.map((t) => t.endung),
);
const BILD_MIMES = new Set(["image/png", "image/jpeg", "image/heic"]);

export function istBild(mime: string | null | undefined): boolean {
  return !!mime && BILD_MIMES.has(mime);
}

/** Die Markenzeichen am Dateianfang, auf die HEIC-Dateien hören. */
const HEIC_MARKEN = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
  "mif1", "msf1",
]);

/**
 * Was ist das für eine Datei -- gelesen am Inhalt.
 *
 * Gibt null zurück, wenn es keiner der vier erlaubten Typen ist. Dass hier
 * nicht die Endung befragt wird, ist der ganze Zweck: Eine Datei namens
 * "grundriss.pdf" kann alles enthalten. Was die Ausliefer-Route später als
 * Content-Type setzt, muss zum Inhalt passen und nicht zum Namen -- sonst
 * schickt der Server ein Dokument mit einer Typangabe los, die der Browser
 * anders auslegt als gedacht.
 */
export function erkenneTyp(
  inhalt: Uint8Array,
): { mime: string; endung: string } | null {
  if (inhalt.length < 12) return null;

  const beginn = (werte: number[]) =>
    werte.every((b, i) => inhalt[i] === b);

  // %PDF-
  if (beginn([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mime: "application/pdf", endung: ".pdf" };
  }
  // \x89PNG\r\n\x1a\n
  if (beginn([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", endung: ".png" };
  }
  // JPEG: FF D8 FF -- gilt für JFIF, Exif und die Varianten dazwischen.
  if (beginn([0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", endung: ".jpg" };
  }
  // HEIC: ISO-BMFF. Ab Byte 4 steht "ftyp", ab Byte 8 die Marke.
  const text = (von: number, bis: number) =>
    String.fromCharCode(...inhalt.slice(von, bis));
  if (text(4, 8) === "ftyp" && HEIC_MARKEN.has(text(8, 12))) {
    return { mime: "image/heic", endung: ".heic" };
  }
  return null;
}

export type Dateipruefung =
  | {
      ok: true;
      mime: string;
      endung: string;
      /** Die Endung des Namens widerspricht dem Inhalt. */
      endungPasstNicht: boolean;
    }
  | { ok: false; fehler: string };

/**
 * Prüft eine hochgeladene Datei.
 *
 * Der Inhalt entscheidet. Widerspricht die Endung dem Inhalt, wird die
 * Datei nicht abgewiesen -- sie wird nach ihrem Inhalt geführt und das
 * Missverhältnis gemeldet. Abgewiesen wird nur, was gar keiner der
 * erlaubten Typen ist.
 */
export function pruefeDatei(
  inhalt: Uint8Array,
  dateiname: string,
): Dateipruefung {
  if (inhalt.length === 0) {
    return { ok: false, fehler: "Die Datei ist leer." };
  }
  if (inhalt.length > GRENZE_BYTES) {
    const mb = (inhalt.length / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      fehler:
        `Die Datei ist ${mb} MB groß. Mehr als ` +
        `${GRENZE_BYTES / 1024 / 1024} MB werden nicht angenommen.`,
    };
  }

  const typ = erkenneTyp(inhalt);
  if (!typ) {
    return {
      ok: false,
      fehler:
        "Dieser Dateityp wird nicht angenommen. Erlaubt sind " +
        ERLAUBTE_TYPEN.map((t) => t.name).join(", ") +
        " — geprüft wird am Inhalt der Datei, nicht an ihrer Endung.",
    };
  }

  const genannt = (dateiname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase();
  const passt =
    genannt === typ.endung ||
    (typ.endung === ".jpg" && genannt === ".jpeg") ||
    (typ.endung === ".heic" && genannt === ".heif");

  return {
    ok: true,
    mime: typ.mime,
    endung: typ.endung,
    endungPasstNicht: genannt !== "" && !passt,
  };
}

// ---------------------------------------------------------------------------
// Namen und Pfade
// ---------------------------------------------------------------------------

/**
 * Macht aus einem hochgeladenen Dateinamen einen Namen.
 *
 * Ein Dateiname aus dem Netz ist Text, kein Pfad. "../../etc/passwd" ist
 * ein gültiger Wert im multipart-Header, und Safari schickt bei einem
 * Ordner-Upload tatsächlich Namen mit Schrägstrichen. Hier bleibt nur der
 * letzte Namensteil übrig.
 *
 * Der Rückgabewert wird angezeigt und als Download-Name vorgeschlagen --
 * er landet NIE in einem Pfad. Das tut nur ablagePfad(), und der nimmt
 * diesen Namen gar nicht an.
 */
export function sichererDateiname(roh: string): string {
  const ohnePfad = String(roh ?? "")
    // Beide Trennzeichen: ein Windows-Browser schickt Backslashes.
    .split(/[/\\]/)
    .pop() as string;

  const sauber = ohnePfad
    // Steuerzeichen (auch NUL) und Anführungszeichen heraus: der Name steht
    // später in einem Content-Disposition-Header.
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    // Ein Name, der nur aus Punkten besteht, ist kein Name.
    .replace(/^\.+$/, "")
    .trim()
    .slice(0, 160);

  return sauber === "" ? "dokument" : sauber;
}

/**
 * Der Name, unter dem die Datei beim Herunterladen vorgeschlagen wird.
 *
 * Die Endung kommt aus dem erkannten Dateityp und nicht aus dem Namen. Das
 * ist dieselbe Entscheidung wie bei der Prüfung, nur am anderen Ende: Wer
 * eine PNG-Datei "grundriss.pdf" nennt, soll sie nicht als "grundriss.pdf"
 * zurückbekommen -- das Betriebssystem öffnet sie dann mit dem falschen
 * Programm und meldet eine beschädigte Datei.
 *
 * Abgeschnitten werden nur die Endungen, die hier vorkommen können. Ein
 * Punkt in "Grundriss 1.5" ist keine Endung.
 */
export function downloadName(d: {
  bezeichnung: string | null;
  dateiname: string;
  mime_typ: string | null;
}): string {
  const roh = (d.bezeichnung ?? "").trim() || d.dateiname;
  const basis = sichererDateiname(roh).replace(
    /\.(pdf|png|jpe?g|heic|heif)$/i,
    "",
  );
  const typ = ERLAUBTE_TYPEN.find((t) => t.mime === d.mime_typ);
  return typ ? `${basis}${typ.endung}` : basis;
}

/** Unterordner der Belegablage. Belege und Dokumente liegen nicht gemischt. */
export const ABLAGE_DOKUMENTE = join(ABLAGE, "dokumente");

/**
 * Der Pfad, unter dem eine Datei liegt.
 *
 * Gebaut aus Inhaltshash, Endung und Monat -- drei Werten, die diese
 * Anwendung selbst erzeugt. Der Name des Hochladenden kommt nicht vor.
 * Trotzdem wird das Ergebnis geprüft: Ein Pfad, der aus der Ablage
 * herausführt, ist ein Programmierfehler, und der soll hier auffallen und
 * nicht erst, wenn eine Datei in /etc liegt.
 */
export function ablagePfad(
  hash: string,
  endung: string,
  monat: string,
  wurzel: string = ABLAGE_DOKUMENTE,
): string {
  if (!/^[0-9a-f]{8,64}$/.test(hash)) {
    throw new Error(`Kein Inhaltshash: ${JSON.stringify(hash)}`);
  }
  if (!ERLAUBTE_ENDUNGEN.has(endung)) {
    throw new Error(`Keine erlaubte Endung: ${JSON.stringify(endung)}`);
  }
  if (!/^\d{4}-\d{2}$/.test(monat)) {
    throw new Error(`Kein Monat im Format JJJJ-MM: ${JSON.stringify(monat)}`);
  }

  const pfad = normalize(join(wurzel, monat, `${hash}${endung}`));
  const grenze = normalize(wurzel) + sep;
  if (!pfad.startsWith(grenze)) {
    throw new Error(`Pfad führt aus der Ablage heraus: ${pfad}`);
  }
  return pfad;
}

// ---------------------------------------------------------------------------
// Wer darf was sehen
// ---------------------------------------------------------------------------

/** Der Bezug eines Dokuments, so wie er in der Tabelle steht. */
export interface DokumentBezug {
  objekt_id: string | null;
  einheit_id: string | null;
  mietverhaeltnis_id: string | null;
  mieter_sichtbar: boolean;
}

/**
 * Wer fragt. Bei einem Mieter stehen hier zusätzlich seine Einheit und sein
 * Objekt -- beides aus der Datenbank geholt, nicht aus der Anfrage.
 */
export interface Zugang {
  rolle: "verwalter" | "lesen" | "mieter";
  mietverhaeltnis?: string | null;
  einheit?: string | null;
  objekt?: string | null;
}

/**
 * Darf dieser Zugang dieses Dokument sehen?
 *
 * Für die Verwaltung ja -- was ein Mandant sieht, hat Postgres über RLS
 * schon entschieden, bevor die Zeile hier ankommt.
 *
 * Für einen Mieter gilt beides zusammen:
 *   1. mieter_sichtbar ist gesetzt. Jemand hat entschieden, dass er das
 *      sehen darf. Ohne diesen Haken nein, auch bei seinem eigenen
 *      Mietverhältnis -- an dem hängen Übergabeprotokolle mit Mängeln und
 *      Schriftverkehr.
 *   2. Kein Bezug des Dokuments widerspricht seinem eigenen. Ein Dokument
 *      mit fremdem Mietverhältnis, fremder Einheit oder fremdem Objekt ist
 *      aus, selbst wenn ein anderer Bezug passt: Das Übergabeprotokoll des
 *      Vormieters hängt an derselben Einheit und ist trotzdem nicht seines.
 *
 * Und mindestens ein Bezug muss wirklich passen. Sonst wäre ein Dokument
 * ohne jeden Bezug für jeden Mieter sichtbar -- die Tabelle verhindert das
 * per CHECK, aber eine Berechtigung, die sich auf einen CHECK verlässt,
 * ist eine Berechtigung weniger.
 */
export function darfSehen(zugang: Zugang, dok: DokumentBezug): boolean {
  if (zugang.rolle === "verwalter" || zugang.rolle === "lesen") return true;

  // Ab hier: Mieter.
  if (!zugang.mietverhaeltnis) return false;
  if (!dok.mieter_sichtbar) return false;

  const mvPasst = dok.mietverhaeltnis_id === zugang.mietverhaeltnis;
  const einheitPasst = !!dok.einheit_id && dok.einheit_id === zugang.einheit;
  const objektPasst = !!dok.objekt_id && dok.objekt_id === zugang.objekt;

  if (dok.mietverhaeltnis_id && !mvPasst) return false;
  if (dok.einheit_id && !einheitPasst) return false;
  if (dok.objekt_id && !objektPasst) return false;

  return mvPasst || einheitPasst || objektPasst;
}

/** Schreiben darf nur die Verwaltung. "lesen" liest, "mieter" gar nicht. */
export function darfSchreiben(rolle: string): boolean {
  return rolle === "verwalter";
}

// ---------------------------------------------------------------------------
// Mietzusammensetzung
// ---------------------------------------------------------------------------

/** Ein Betrag, wie er aus numeric(10,2) kommt: Text, Zahl oder null. */
export type Betrag = string | number | null | undefined;

function zahl(wert: Betrag): number {
  if (wert === null || wert === undefined || String(wert).trim() === "") return 0;
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
}

const cent = (n: number) => Math.round(n * 100) / 100;

export interface Mietwerte {
  kaltmiete: Betrag;
  nebenkosten: Betrag;
  moeblierung: Betrag;
  gesamtmiete: Betrag;
}

export interface Mietposten {
  bezeichnung: string;
  betrag: number;
}

export interface Mietsumme {
  posten: Mietposten[];
  /** Was geschuldet ist: die zugesagte Gesamtmiete, sonst die Summe. */
  summe: number;
  /** Inklusivmiete: nur ein Gesamtbetrag vereinbart, keine Posten. */
  inklusiv: boolean;
  /**
   * Gesamtmiete minus Summe der Posten, wenn beides da ist und auseinander
   * geht. Das ist keine Spielerei: In der Differenz steckt regelmäßig ein
   * Möblierungszuschlag, der nirgends eingetragen ist.
   */
  abweichung: number | null;
}

/**
 * Die Miete, aufgeschlüsselt wie im Vertrag.
 *
 * Maßgeblich ist die zugesagte Gesamtmiete -- geschuldet ist, was
 * vereinbart wurde, nicht was die Summe der Posten ergibt. Dieselbe Regel
 * wie sollGesamt() in lib/sollstellung.ts; sie wird hier nicht
 * nachgerechnet, sondern nur anders dargestellt.
 */
export function mietzusammensetzung(w: Mietwerte): Mietsumme {
  const kalt = zahl(w.kaltmiete);
  const nk = zahl(w.nebenkosten);
  const moebel = zahl(w.moeblierung);
  const gesamt = zahl(w.gesamtmiete);

  const posten: Mietposten[] = [];
  if (kalt > 0) posten.push({ bezeichnung: "Kaltmiete", betrag: cent(kalt) });
  if (nk > 0) posten.push({ bezeichnung: "Nebenkosten", betrag: cent(nk) });
  // Nur wenn es ihn gibt. Eine Zeile "Möblierungszuschlag 0,00 €" lässt
  // ein unmöbliertes Zimmer möbliert aussehen.
  if (moebel > 0) {
    posten.push({ bezeichnung: "Möblierungszuschlag", betrag: cent(moebel) });
  }

  const postenSumme = cent(kalt + nk + moebel);
  const summe = gesamt > 0 ? cent(gesamt) : postenSumme;
  const abweichung =
    gesamt > 0 && postenSumme > 0 && Math.abs(gesamt - postenSumme) > 0.005
      ? cent(gesamt - postenSumme)
      : null;

  return {
    posten,
    summe,
    inklusiv: gesamt > 0 && posten.length === 0,
    abweichung,
  };
}

// ---------------------------------------------------------------------------
// Welche Miete gilt wann
// ---------------------------------------------------------------------------

/** Eine Mietanpassung, wie db/022 sie führt. */
export interface Anpassung extends Mietwerte {
  gilt_ab: string;
  grund: string;
  beleg?: string | null;
}

export interface GueltigeMiete {
  werte: Mietwerte;
  miete: Mietsumme;
  /** "Mietvertrag" oder "Mietanpassung ab 01.07.2026 (mieterhoehung)". */
  quelle: string;
  /** Ab wann dieser Betrag gilt. null = seit Vertragsbeginn. */
  giltAb: string | null;
}

/**
 * Der Betrag, der am Stichtag gilt, und woher er kommt.
 *
 * Dieselbe Auswahl wie miete_am() in db/022 und betragImMonat() in
 * lib/sollstellung.ts: die jüngste Anpassung mit gilt_ab <= Stichtag, sonst
 * die Werte am Mietverhältnis. Hier zusätzlich mit der Herkunft, weil die
 * Frage auf der Einheitenseite "warum 944 Euro?" lautet und nicht "wie
 * viel?".
 */
export function gueltigeMiete(
  anpassungen: Anpassung[],
  vertrag: Mietwerte,
  stichtagISO: string,
): GueltigeMiete {
  const gueltig = anpassungen
    .filter((a) => a.gilt_ab <= stichtagISO)
    .sort((a, b) => (a.gilt_ab < b.gilt_ab ? 1 : -1))[0];

  if (!gueltig) {
    return {
      werte: vertrag,
      miete: mietzusammensetzung(vertrag),
      quelle: "Mietvertrag",
      giltAb: null,
    };
  }
  return {
    werte: gueltig,
    miete: mietzusammensetzung(gueltig),
    quelle: `Mietanpassung ab ${gueltig.gilt_ab}${
      gueltig.grund ? ` (${gueltig.grund})` : ""
    }`,
    giltAb: gueltig.gilt_ab,
  };
}

/** Der Tag davor, als ISO-Datum. Reine Rechnung, UTC. */
export function vortag(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface ZeitleisteEintrag {
  giltAb: string;
  /** Letzter Tag dieses Betrags. null = läuft weiter. */
  bis: string | null;
  quelle: string;
  grund: string | null;
  beleg: string | null;
  miete: Mietsumme;
}

/**
 * Die Miete dieses Mietverhältnisses als Zeitleiste.
 *
 * Der erste Eintrag ist der Vertrag selbst -- außer eine Anpassung gilt
 * bereits ab Vertragsbeginn oder davor; dann hat der Vertragsbetrag nie
 * gegolten und wird auch nicht gezeigt. Sonst stünde über der Zeitleiste
 * ein Betrag, den niemand je geschuldet hat.
 */
export function mietZeitleiste(
  beginn: string,
  ende: string | null,
  anpassungen: Anpassung[],
  vertrag: Mietwerte,
): ZeitleisteEintrag[] {
  const sortiert = [...anpassungen].sort((a, b) =>
    a.gilt_ab < b.gilt_ab ? -1 : a.gilt_ab > b.gilt_ab ? 1 : 0,
  );

  const eintraege: ZeitleisteEintrag[] = [];
  if (sortiert.length === 0 || sortiert[0].gilt_ab > beginn) {
    eintraege.push({
      giltAb: beginn,
      bis: null,
      quelle: "Mietvertrag",
      grund: null,
      beleg: null,
      miete: mietzusammensetzung(vertrag),
    });
  }
  for (const a of sortiert) {
    eintraege.push({
      giltAb: a.gilt_ab,
      bis: null,
      quelle: "Mietanpassung",
      grund: a.grund ?? null,
      beleg: a.beleg ?? null,
      miete: mietzusammensetzung(a),
    });
  }

  for (let i = 0; i < eintraege.length; i++) {
    const naechster = eintraege[i + 1];
    eintraege[i].bis = naechster ? vortag(naechster.giltAb) : ende;
  }
  return eintraege;
}

// ---------------------------------------------------------------------------
// Baujahr
// ---------------------------------------------------------------------------

/**
 * Das Baujahr aus den Notizen des Objekts.
 *
 * Es gibt dafür keine Spalte. Was es gibt, ist der Satz "Baujahr 1957,
 * Sanierung 2017" in objekt.notizen (db/006). Eine Spalte anzulegen wäre
 * Sache einer eigenen Migration; bis dahin wird der Wert gelesen, wo er
 * steht, statt die Angabe auf der Objektseite weglassen zu müssen.
 *
 * Erkennt nur das ausdrücklich benannte Baujahr. Eine beliebige
 * vierstellige Zahl aus dem Notizfeld wäre geraten -- im selben Satz steht
 * ein Sanierungsjahr.
 */
export function baujahrAusNotizen(notizen: string | null): string | null {
  if (!notizen) return null;
  const m = notizen.match(/\bBaujahr\s*:?\s*(1[89]\d{2}|20\d{2})\b/i);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Ablage und Datenbank
// ---------------------------------------------------------------------------

/** Der Bezug, unter dem ein Dokument hängt. Genau einer der drei. */
export interface Bezug {
  objekt_id?: string | null;
  einheit_id?: string | null;
  mietverhaeltnis_id?: string | null;
}

export interface DokumentZeile {
  id: string;
  art: Dokumentart;
  bezeichnung: string | null;
  dateiname: string;
  mime_typ: string | null;
  groesse_bytes: string | null;
  sortierung: number;
  mieter_sichtbar: boolean;
  angelegt_am: string;
  objekt_id: string | null;
  einheit_id: string | null;
  mietverhaeltnis_id: string | null;
}

/**
 * Die Spalten, die nach außen gehen dürfen.
 *
 * ablage_pfad ist nicht dabei, und zwar überall nicht: Diese Zeilen werden
 * an Oberflächenbausteine übergeben und landen damit im HTML. Ein Pfad auf
 * der Platte hat dort nichts zu suchen -- ausgeliefert wird über
 * /api/dokumente/<id>, und nur die Route kennt den Pfad.
 */
const SPALTEN = `id, art, bezeichnung, dateiname, mime_typ,
                 groesse_bytes::text, sortierung, mieter_sichtbar,
                 angelegt_am::text, objekt_id, einheit_id, mietverhaeltnis_id`;

/** Alle Dokumente zu einem Bezug, Galerie-Reihenfolge. */
export async function dokumenteFuer(bezug: Bezug): Promise<DokumentZeile[]> {
  return query<DokumentZeile>(
    `SELECT ${SPALTEN}
       FROM dokument
      WHERE ($1::uuid IS NOT NULL AND objekt_id = $1::uuid)
         OR ($2::uuid IS NOT NULL AND einheit_id = $2::uuid)
         OR ($3::uuid IS NOT NULL AND mietverhaeltnis_id = $3::uuid)
      ORDER BY sortierung, angelegt_am`,
    [
      bezug.objekt_id ?? null,
      bezug.einheit_id ?? null,
      bezug.mietverhaeltnis_id ?? null,
    ],
  );
}

/** Eine Zeile mit Pfad -- nur für die Ausliefer-Route. */
export async function dokumentMitPfad(
  id: string,
): Promise<(DokumentZeile & { ablage_pfad: string }) | null> {
  return one<DokumentZeile & { ablage_pfad: string }>(
    `SELECT ${SPALTEN}, ablage_pfad FROM dokument WHERE id = $1`,
    [id],
  );
}

/**
 * Legt eine geprüfte Datei ab und schreibt die Zeile.
 *
 * Der Dateiname auf der Platte ist der Hash des Inhalts -- dasselbe Muster
 * wie sichereAnhang() in lib/belege.ts. Derselbe Grundriss, an zwei Zimmer
 * gehängt, liegt damit einmal. Das heißt umgekehrt: Beim Löschen darf die
 * Datei erst weg, wenn keine Zeile mehr auf sie zeigt (siehe loesche()).
 */
export async function speichere(e: {
  bezug: Bezug;
  art: Dokumentart;
  bezeichnung: string | null;
  mieterSichtbar: boolean;
  dateiname: string;
  inhalt: Uint8Array;
  mime: string;
  endung: string;
}): Promise<{ id: string; ablage_pfad: string }> {
  const daten = Buffer.from(e.inhalt);
  const hash = createHash("sha256").update(daten).digest("hex").slice(0, 24);
  const monat = new Date().toISOString().slice(0, 7);
  const pfad = ablagePfad(hash, e.endung, monat);

  await mkdir(join(ABLAGE_DOKUMENTE, monat), { recursive: true });
  await writeFile(pfad, daten);

  const [zeile] = await query<{ id: string }>(
    `INSERT INTO dokument
       (objekt_id, einheit_id, mietverhaeltnis_id, art, bezeichnung,
        dateiname, mime_typ, groesse_bytes, ablage_pfad, mieter_sichtbar,
        sortierung)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             COALESCE((SELECT max(sortierung) + 1 FROM dokument d
                        WHERE d.objekt_id IS NOT DISTINCT FROM $1
                          AND d.einheit_id IS NOT DISTINCT FROM $2
                          AND d.mietverhaeltnis_id IS NOT DISTINCT FROM $3), 0))
     RETURNING id`,
    [
      e.bezug.objekt_id ?? null,
      e.bezug.einheit_id ?? null,
      e.bezug.mietverhaeltnis_id ?? null,
      e.art,
      e.bezeichnung,
      e.dateiname,
      e.mime,
      daten.length,
      pfad,
      e.mieterSichtbar,
    ],
  );

  return { id: zeile.id, ablage_pfad: pfad };
}

/** Der Inhalt einer Datei von der Platte. */
export async function leseInhalt(pfad: string): Promise<Buffer> {
  return readFile(pfad);
}

/**
 * Löscht ein Dokument.
 *
 * Erst die Zeile, dann die Datei -- und die nur, wenn keine andere Zeile
 * mehr auf denselben Pfad zeigt. Weil der Dateiname der Inhaltshash ist,
 * teilen sich gleiche Dateien einen Pfad; wer blind löscht, nimmt einem
 * anderen Dokument die Datei weg.
 *
 * Die Prüfung läuft ohne Mandantenfilter nicht -- kann sie auch nicht,
 * RLS ist an. Ein Dokument eines anderen Mandanten mit demselben Inhalt
 * bliebe also unentdeckt, und die Datei würde entfernt. Das ist bewusst
 * so hingenommen und nicht stillschweigend: Der Hash ist auf 24 Zeichen
 * gekürzt, aber mandantenübergreifend derselbe Inhalt bedeutet denselben
 * Grundriss zweier Vermieter -- und gegen den Fall hilft hier nur, die
 * Datei stehen zu lassen. Deshalb wird sie es, sobald irgendetwas unklar
 * ist: Ein Fehler beim Entfernen lässt die Zeile gelöscht und die Datei
 * liegen, nie umgekehrt.
 */
export async function loesche(id: string): Promise<boolean> {
  const zeile = await one<{ ablage_pfad: string }>(
    `DELETE FROM dokument WHERE id = $1 RETURNING ablage_pfad`,
    [id],
  );
  if (!zeile) return false;

  const [noch] = await query<{ anzahl: string }>(
    `SELECT count(*)::text AS anzahl FROM dokument WHERE ablage_pfad = $1`,
    [zeile.ablage_pfad],
  );
  if (Number(noch?.anzahl ?? 1) === 0) {
    await unlink(zeile.ablage_pfad).catch(() => {});
  }
  return true;
}

/**
 * Einheit und Objekt zu einem Mietverhältnis -- für die Mieterprüfung.
 *
 * Kommt aus der Datenbank und nicht aus der Anfrage. Der Mieter schickt
 * nur sein Sitzungscookie mit; welche Wohnung dazugehört, entscheidet
 * diese Abfrage.
 */
export async function mieterBezug(
  mietverhaeltnisId: string,
): Promise<Zugang | null> {
  const z = await one<{ einheit_id: string; objekt_id: string }>(
    `SELECT mv.einheit_id, e.objekt_id
       FROM mietverhaeltnis mv
       JOIN einheit e ON e.id = mv.einheit_id
      WHERE mv.id = $1`,
    [mietverhaeltnisId],
  );
  if (!z) return null;
  return {
    rolle: "mieter",
    mietverhaeltnis: mietverhaeltnisId,
    einheit: z.einheit_id,
    objekt: z.objekt_id,
  };
}
