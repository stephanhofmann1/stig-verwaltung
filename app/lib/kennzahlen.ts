import { query } from "./db";
import { monatsStatus, type StandZeile, type ZahlStatus } from "./mieter";
import { dritterWerktag, type Rueckstand } from "./mahnstufen";
import { mahnstand, hoechsteMonatsmiete } from "./rueckstaende";
import { zurueckgestellteIds } from "./mahnablauf";
import { freigabe } from "./mahnfreigabe";
import { verfuegbarkeit, type Verfuegbarkeit } from "./oeffentlich";

/**
 * Die Kennzahlen des Vermieter-Cockpits.
 *
 * Aufgeteilt in zwei Haelften, und die Trennung ist der Zweck der Datei:
 *
 *   OBEN   reine Rechnerei. Kein Datenbankzugriff, kein `new Date()` ohne
 *          Uebergabe. Jede dieser Funktionen hat Tests in
 *          tests/kennzahlen.test.ts.
 *   UNTEN  das Lesen aus der Datenbank. Nur Abfragen und Zusammenstellen;
 *          gerechnet wird dort nichts.
 *
 * Der Grund fuer die Trennung ist derselbe wie in mahnstufen.ts: Eine Zahl
 * auf der Startseite wird geglaubt. Steht die Rechnung mitten in einer
 * Abfrage, laesst sie sich nur mit laufender Datenbank und echtem Bestand
 * pruefen -- also praktisch nie.
 *
 * Die wichtigste Regel in dieser Datei ist eine Verneinung: **Eine
 * Kennzahl, die auf unvollstaendigen Daten beruht, behauptet keine Zahl.**
 * `objekt.zahlungsdaten_ab` (db/023) sagt, ab wann Kontoumsaetze vorliegen.
 * Monate davor sind nicht unbezahlt, sondern unbekannt. Beides zu addieren
 * waere der teuerste Fehler, den diese Seite machen kann -- die Begruendung
 * steht ausfuehrlich in mahnstufen.ts und in lib/mieter.ts.
 */

// ===========================================================================
// Reine Rechnerei
// ===========================================================================

/** Auf zwei Stellen, damit sich Cent-Reste nicht aufsummieren. */
function runde(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Der Tag eines Zeitpunkts als ISO-Datum, ohne Uhrzeit. */
export function isoTag(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ganze Tage von heute bis zu einem Datum. Negativ heisst: schon vorbei.
 *
 * Beide Seiten werden auf Mitternacht UTC normiert. Ohne das haengt das
 * Ergebnis an der Uhrzeit des Seitenaufrufs -- eine Frist waere morgens
 * "in 30 Tagen" und abends "in 29".
 */
export function tageBis(isoDatum: string, heute: Date): number {
  const ziel = Date.parse(isoDatum.slice(0, 10) + "T00:00:00Z");
  const jetzt = Date.parse(isoTag(heute) + "T00:00:00Z");
  return Math.round((ziel - jetzt) / 86_400_000);
}

/** Datum plus n Monate, auf Monatsebene (fuer Zeitfenster). */
export function plusMonate(d: Date, n: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** Erster des Monats als ISO-Datum. */
export function monatsErster(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// --- 1. Fristen -------------------------------------------------------------

export type Dringlichkeit = "verstrichen" | "kritisch" | "knapp" | "ruhig";

export interface FristZeile {
  bezeichnung: string;
  faellig_am: string;
  grundlage: string | null;
  betrag: string | null;
  haengt_an: string | null;
}

export interface FristLage extends FristZeile {
  resttage: number;
  dringlichkeit: Dringlichkeit;
}

/**
 * Wie dringend ist eine Frist?
 *
 * Die Schwellen sind dieselben wie im Lagebericht (lib/lagebericht.ts):
 * haengt die Frist an einem Dritten -- einem Versorger, der Zahlen
 * nachliefern muss, der WEG-Verwaltung --, zaehlt sie frueher als kritisch.
 * Man kann sie nicht am letzten Tag noch selbst erledigen.
 *
 * Bei § 556 Abs. 3 Satz 2 BGB heisst zu spaet nicht "spaeter", sondern die
 * Nachforderung ist weg. Deshalb faengt die Warnung 90 Tage vorher an und
 * nicht 30.
 */
export function fristDringlichkeit(
  resttage: number,
  haengtAn: string | null,
): Dringlichkeit {
  if (resttage < 0) return "verstrichen";
  const schwelle = haengtAn ? 60 : 30;
  if (resttage <= schwelle) return "kritisch";
  if (resttage <= 90) return "knapp";
  return "ruhig";
}

/** Fristen mit Resttagen, die naechste zuerst. */
export function fristenLage(zeilen: FristZeile[], heute: Date): FristLage[] {
  return zeilen
    .map((f) => {
      const resttage = tageBis(f.faellig_am, heute);
      return {
        ...f,
        resttage,
        dringlichkeit: fristDringlichkeit(resttage, f.haengt_an),
      };
    })
    .sort((a, b) => a.resttage - b.resttage);
}

// --- 3. Geld im laufenden Monat ---------------------------------------------

export interface MonatsPosten {
  mietverhaeltnis_id: string;
  soll: number;
  gezahlt: number;
  status: ZahlStatus;
}

export interface MonatsGeld {
  /** Sollstellungen im Monat. 0 = der Nachtlauf hat noch nichts erzeugt. */
  anzahl: number;
  soll: number;
  bezahlt: number;
  /** Faellig und nicht gedeckt -- nur aus Monaten MIT Kontodaten. */
  offen: number;
  /** Mietverhaeltnisse hinter `offen`. */
  offenBetroffen: number;
  /** Gestellt, aber die Schonfrist laeuft noch. Kein Rueckstand. */
  nochNichtFaellig: number;
  /**
   * Betrag aus Posten ohne Kontodaten. Zaehlt absichtlich NICHT in `offen`:
   * ohne Auszug ist unbekannt, ob gezahlt wurde, und Unbekanntes ist kein
   * Rueckstand.
   */
  unabgeglichen: number;
  unabgeglichenAnzahl: number;
  /**
   * Darf ueber offene Betraege ueberhaupt etwas gesagt werden?
   *
   * false heisst: es gibt keinen einzigen Posten mit Kontodaten. Dann ist
   * `offen` zwangslaeufig 0 -- und eine angezeigte Null waere die Aussage
   * "alles bezahlt", also eine Behauptung ueber Daten, die es nicht gibt.
   */
  belastbar: boolean;
}

/**
 * Fasst den laufenden Monat zusammen.
 *
 * Der Status je Posten kommt von monatsStatus() aus lib/mieter.ts -- dort
 * steckt die Unterscheidung zwischen "offen" und "noch nicht abgeglichen",
 * und sie wird hier nicht noch einmal nachgebaut.
 */
export function monatsGeld(posten: MonatsPosten[]): MonatsGeld {
  let soll = 0;
  let bezahlt = 0;
  let offen = 0;
  let nochNichtFaellig = 0;
  let unabgeglichen = 0;
  let unabgeglichenAnzahl = 0;
  const betroffen = new Set<string>();
  let mitDaten = 0;

  for (const p of posten) {
    const rest = runde(p.soll - p.gezahlt);
    soll += p.soll;
    // Gedeckelt: Eine Zuordnung ist nie hoeher als der offene Betrag
    // (lib/zuordnung.ts), aber "1.200 von 1.000 bezahlt" waere auch kein
    // Satz, den man einem Vermieter morgens zeigt.
    bezahlt += Math.min(p.gezahlt, p.soll);

    if (p.status === "nicht_abgeglichen") {
      unabgeglichen += rest;
      unabgeglichenAnzahl++;
      continue;
    }
    mitDaten++;
    if (p.status === "nicht_faellig") {
      nochNichtFaellig += rest;
    } else if (p.status === "offen" || p.status === "teilweise") {
      offen += rest;
      betroffen.add(p.mietverhaeltnis_id);
    }
  }

  return {
    anzahl: posten.length,
    soll: runde(soll),
    bezahlt: runde(bezahlt),
    offen: runde(offen),
    offenBetroffen: betroffen.size,
    nochNichtFaellig: runde(nochNichtFaellig),
    unabgeglichen: runde(unabgeglichen),
    unabgeglichenAnzahl,
    belastbar: mitDaten > 0,
  };
}

// --- 4. Rueckstaende --------------------------------------------------------

export interface RueckstandsLage {
  /** Rueckstaende, fuer die ein Schreiben vorgesehen waere. */
  zuSchreiben: number;
  summe: number;
  /** Sichtbar, aber unter der Schwelle -- kein Schreiben. */
  beobachten: number;
  summeBeobachten: number;
  /** Faelle mit Betraegen aus Monaten ohne Kontodaten. */
  ungeklaert: number;
  summeUngeklaert: number;
}

/**
 * Zaehlt die Rueckstaende zusammen, die mahnstand() geliefert hat.
 *
 * `summe` enthaelt nur `offen`, nie `offen_ohne_daten`. Die beiden Zahlen
 * stehen im Cockpit nebeneinander und werden nie addiert -- aus demselben
 * Grund, aus dem mahnstufen.ts sie trennt.
 */
export function rueckstandsLage(stand: Rueckstand[]): RueckstandsLage {
  const zuSchreiben = stand.filter(
    (r) => r.stufe === "mahnung" || r.stufe === "erinnerung",
  );
  const beobachten = stand.filter((r) => r.stufe === "faellig" && r.offen >= 1);
  const ungeklaert = stand.filter((r) => r.offen_ohne_daten >= 1);
  const summe = (liste: Rueckstand[], feld: "offen" | "offen_ohne_daten") =>
    runde(liste.reduce((s, r) => s + r[feld], 0));

  return {
    zuSchreiben: zuSchreiben.length,
    summe: summe(zuSchreiben, "offen"),
    beobachten: beobachten.length,
    summeBeobachten: summe(beobachten, "offen"),
    ungeklaert: ungeklaert.length,
    summeUngeklaert: summe(ungeklaert, "offen_ohne_daten"),
  };
}

// --- 5. Leerstand -----------------------------------------------------------

export interface EinheitLage {
  objekt: string;
  einheit: string;
  status: Verfuegbarkeit;
  frei_ab: string | null;
  hinweis: string | null;
}

export interface LeerstandsLage {
  frei: EinheitLage[];
  /** Wird im Zeitfenster frei. Ohne Termin zuerst -- das ist das Offene. */
  bald: EinheitLage[];
  belegt: number;
  gesamt: number;
}

/**
 * Leerstand und was bald frei wird.
 *
 * Die Einheiten kommen aus verfuegbarkeit() in lib/oeffentlich.ts, also aus
 * derselben Ableitung, die auch die Website speist. Das ist Absicht: Zwei
 * Belegungslogiken laufen auseinander, und dann bewirbt eine von beiden ein
 * bewohntes Zimmer. Die Beweislast liegt dort beim Leerstand -- aus
 * fehlenden Daten entsteht nie "frei".
 */
export function leerstandsLage(
  einheiten: EinheitLage[],
  heute: Date,
  monate = 3,
): LeerstandsLage {
  const grenze = plusMonate(heute, monate);
  const imFenster = (e: EinheitLage) =>
    e.frei_ab === null ||
    Date.parse(e.frei_ab.slice(0, 10) + "T00:00:00Z") <= grenze.getTime();

  const nachTermin = (a: EinheitLage, b: EinheitLage) => {
    // Ohne Termin nach oben: Ein Zimmer, dessen Auszugsdatum am Nachmieter
    // haengt, ist die Aufgabe -- nicht das mit dem festen Datum.
    if ((a.frei_ab === null) !== (b.frei_ab === null)) return a.frei_ab === null ? -1 : 1;
    if (a.frei_ab && b.frei_ab && a.frei_ab !== b.frei_ab)
      return a.frei_ab < b.frei_ab ? -1 : 1;
    return a.einheit.localeCompare(b.einheit, "de");
  };

  return {
    frei: einheiten.filter((e) => e.status === "frei").sort(nachTermin),
    bald: einheiten
      .filter((e) => e.status === "bald" && imFenster(e))
      .sort(nachTermin),
    belegt: einheiten.filter((e) => e.status === "belegt").length,
    gesamt: einheiten.length,
  };
}

// --- 6. Cashflow ------------------------------------------------------------

export interface CashflowZeile {
  /** "YYYY-MM". */
  monat: string;
  ein: number;
  aus: number;
  /** Anteil der Eingaenge, der einer Sollstellung zugeordnet ist. */
  miete: number;
}

export interface CashflowBalken extends CashflowZeile {
  /** Eingaenge ohne Zuordnung zu einer Sollstellung. */
  sonstige: number;
}

/**
 * Macht aus den vorhandenen Monaten eine lueckenlose Reihe.
 *
 * Ein Monat ohne Buchung fehlt in der Abfrage. Wuerde man einfach die
 * gelieferten Zeilen zeichnen, ruecken die Balken zusammen und ein
 * Ausfallmonat -- genau der interessante -- verschwindet.
 */
export function cashflowReihe(
  zeilen: CashflowZeile[],
  bis: Date,
  monate = 12,
): CashflowBalken[] {
  const nach = new Map(zeilen.map((z) => [z.monat.slice(0, 7), z]));
  const aus: CashflowBalken[] = [];
  for (let i = monate - 1; i >= 0; i--) {
    const d = plusMonate(new Date(Date.UTC(bis.getUTCFullYear(), bis.getUTCMonth(), 1)), -i);
    const schluessel = monatsErster(d).slice(0, 7);
    const z = nach.get(schluessel);
    const ein = runde(z?.ein ?? 0);
    // Gedeckelt, weil eine Zuordnung nie hoeher sein kann als die Buchung,
    // zu der sie gehoert -- eine negative "sonstige" Einnahme waere Unsinn.
    const miete = Math.min(runde(z?.miete ?? 0), ein);
    aus.push({
      monat: schluessel,
      ein,
      miete,
      sonstige: runde(ein - miete),
      aus: runde(z?.aus ?? 0),
    });
  }
  return aus;
}

/** Der groesste Balken der Reihe -- der Bezugswert fuer alle anderen. */
export function spitze(reihe: CashflowBalken[]): number {
  return reihe.reduce((m, b) => Math.max(m, b.ein, b.aus), 0);
}

/** Anteil eines Werts an der Spitze, 0 bis 1. */
export function anteil(wert: number, maximum: number): number {
  if (!(maximum > 0) || !(wert > 0)) return 0;
  return Math.min(1, wert / maximum);
}

// --- 7. Zustand der Automatik -----------------------------------------------

export type LaufLage = "nie" | "steht" | "gescheitert" | "hinweise" | "ok";

export interface LaufZeile {
  name: string;
  begonnen_am: string;
  ok: boolean;
  hinweise: string[];
  ergebnis?: unknown;
}

export interface AutomatikPosten {
  name: string;
  lage: LaufLage;
  begonnen_am: string | null;
  /** Wie viele Laeufe dieser Art zuletzt hintereinander gescheitert sind. */
  serie: number;
  hinweis: string | null;
}

/**
 * Der Zustand eines einzelnen Laufs.
 *
 * Die Reihenfolge ist die Logik: "steht" kommt vor "gescheitert", weil ein
 * alter Erfolgslauf schlimmer ist als ein frischer Fehler. Ein ok von
 * vorletzter Woche ist kein ok -- es bedeutet, dass der Zeitplaner die
 * Anwendung nicht erreicht, und dann sind alle anderen Zahlen auf dieser
 * Seite ebenfalls von vorletzter Woche.
 */
export function laufLage(
  l: { begonnen_am: string; ok: boolean; hinweise: string[] } | undefined,
  heute: Date,
  maxStunden = 26,
): LaufLage {
  if (!l) return "nie";
  const stunden = (heute.getTime() - Date.parse(l.begonnen_am)) / 3_600_000;
  if (stunden > maxStunden) return "steht";
  if (!l.ok) return "gescheitert";
  if (l.hinweise.length > 0) return "hinweise";
  return "ok";
}

/**
 * Wie viele Laeufe hintereinander gescheitert sind, vom jüngsten aus.
 *
 * Das ist der Unterschied zwischen einer Stoerung und einem Dauerzustand.
 * Ein Lauf, der seit drei Wochen an einem abgelaufenen Token scheitert,
 * sieht in einer Momentaufnahme genauso aus wie einer, der gestern einmal
 * umgefallen ist -- und nur der erste gehoert aufs Cockpit.
 */
export function serieGescheitert(laeufe: Array<{ ok: boolean }>): number {
  let n = 0;
  for (const l of laeufe) {
    if (l.ok) break;
    n++;
  }
  return n;
}

/** Laeufe einer Art, jüngster zuerst. */
function jeName(zeilen: LaufZeile[], name: string): LaufZeile[] {
  return zeilen
    .filter((z) => z.name === name)
    .sort((a, b) => Date.parse(b.begonnen_am) - Date.parse(a.begonnen_am));
}

/** Zustand je erwarteter Lauf, Auffaelliges zuerst. */
export function automatikLage(
  zeilen: LaufZeile[],
  erwartet: readonly string[],
  heute: Date,
): AutomatikPosten[] {
  const rang: Record<LaufLage, number> = {
    nie: 0,
    steht: 1,
    gescheitert: 2,
    hinweise: 3,
    ok: 4,
  };

  return erwartet
    .map((name) => {
      const liste = jeName(zeilen, name);
      const neuester = liste[0];
      return {
        name,
        lage: laufLage(neuester, heute),
        begonnen_am: neuester?.begonnen_am ?? null,
        serie: serieGescheitert(liste),
        hinweis: neuester?.hinweise[0] ?? null,
      };
    })
    .sort((a, b) => rang[a.lage] - rang[b.lage] || b.serie - a.serie);
}

export interface LageberichtLage {
  /** Lief der Lagebericht heute? */
  gelaufen: boolean;
  /** Hat er die Nachricht auch verschickt? */
  versendet: boolean;
  begonnen_am: string | null;
}

/**
 * Ging der Lagebericht heute raus?
 *
 * "gelaufen" und "versendet" sind zwei Fragen. Ein Lauf, der ok meldet und
 * nichts verschickt hat, ist der stille Fall: Der Zeitplaner meldet gruen,
 * und auf dem Telefon kommt nichts an.
 */
export function lageberichtLage(
  zeilen: LaufZeile[],
  heute: Date,
): LageberichtLage {
  const heuteIso = isoTag(heute);
  const l = jeName(zeilen, "lagebericht").find(
    (z) => z.begonnen_am.slice(0, 10) === heuteIso,
  );
  if (!l) return { gelaufen: false, versendet: false, begonnen_am: null };
  const e = (l.ergebnis ?? {}) as Record<string, unknown>;
  return {
    gelaufen: true,
    versendet: l.ok && e.versendet === true,
    begonnen_am: l.begonnen_am,
  };
}

// ===========================================================================
// Lesen aus der Datenbank
// ===========================================================================
//
// Ab hier wird nur abgefragt und an die Funktionen oben weitergegeben. Der
// Mandant wird nirgends gesetzt -- er kommt aus der Sitzung, und jede
// Tabelle hat RLS.

/** Die Laeufe, die es geben muss. Dieselbe Liste wie unter /laeufe. */
export const ERWARTETE_LAEUFE = [
  "bankabruf",
  "mailabruf",
  "agent",
  "nachfassen",
  "sollstellungen",
  "lagebericht",
] as const;

/**
 * Faengt den Fehler einer einzelnen Kennzahl ab.
 *
 * Wie `behutsam` in lib/lagebericht.ts: Eine Abfrage, die scheitert -- weil
 * eine Migration fehlt oder eine Tabelle leer ist --, darf nicht die ganze
 * Startseite weissen. Der Fehler wird gesammelt und unten auf der Seite
 * genannt, damit er nicht nur still verschwindet.
 */
async function behutsam<T>(
  was: string,
  f: () => Promise<T>,
  standard: T,
): Promise<{ wert: T; fehler: string | null }> {
  try {
    return { wert: await f(), fehler: null };
  } catch (e) {
    return { wert: standard, fehler: `${was}: ${(e as Error).message}` };
  }
}

async function ladeFristen(heute: Date): Promise<FristLage[]> {
  const zeilen = await query<FristZeile>(`
    SELECT bezeichnung, faellig_am::text, grundlage, betrag::text, haengt_an
      FROM frist
     WHERE erledigt_am IS NULL
     ORDER BY faellig_am
  `);
  return fristenLage(zeilen, heute);
}

interface MonatsZeile extends StandZeile {
  mietverhaeltnis_id: string;
}

/**
 * Der laufende Monat.
 *
 * Die Abfrage ist die aus lib/mieter.ts (zahlungsstand), nur ueber alle
 * Mietverhaeltnisse statt eines -- einschliesslich des Flags
 * `ohne_zahlungsdaten`. Der Zusatz `NOT EXISTS (SELECT 1 FROM buchung)`
 * gehoert dazu: Solange gar keine Umsaetze eingelesen sind, ist JEDER Monat
 * unabgeglichen und nicht offen.
 */
async function ladeMonat(heute: Date): Promise<{ monat: string; geld: MonatsGeld }> {
  const zeilen = await query<MonatsZeile>(`
    SELECT s.mietverhaeltnis_id,
           s.monat::text,
           s.betrag::text  AS soll,
           z.gezahlt::text AS gezahlt,
           z.letzte::text  AS gezahlt_am,
           (o.zahlungsdaten_ab IS NULL
            OR s.monat < date_trunc('month', o.zahlungsdaten_ab)::date
            OR NOT EXISTS (SELECT 1 FROM buchung)) AS ohne_zahlungsdaten
      FROM sollstellung s
      JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
      JOIN einheit e ON e.id = mv.einheit_id
      JOIN objekt  o ON o.id = e.objekt_id
      LEFT JOIN (
            SELECT zz.sollstellung_id,
                   SUM(zz.betrag)     AS gezahlt,
                   MAX(b.buchungstag) AS letzte
              FROM zuordnung zz
              JOIN buchung b ON b.id = zz.buchung_id
             GROUP BY zz.sollstellung_id
      ) z ON z.sollstellung_id = s.id
     WHERE s.monat = date_trunc('month', CURRENT_DATE)::date
  `);

  const posten: MonatsPosten[] = zeilen.map((z) => {
    const [j, m] = z.monat.split("-").map(Number);
    const stand = monatsStatus(z, dritterWerktag(j, m), heute);
    return {
      mietverhaeltnis_id: z.mietverhaeltnis_id,
      soll: stand.soll,
      gezahlt: stand.gezahlt,
      status: stand.status,
    };
  });

  return { monat: monatsErster(heute), geld: monatsGeld(posten) };
}

async function ladeCashflow(heute: Date): Promise<CashflowBalken[]> {
  const zeilen = await query<{
    monat: string;
    ein: number;
    aus: number;
    miete: number;
  }>(`
    SELECT to_char(date_trunc('month', b.buchungstag), 'YYYY-MM') AS monat,
           SUM(CASE WHEN b.betrag > 0 THEN  b.betrag ELSE 0 END)::float8 AS ein,
           SUM(CASE WHEN b.betrag < 0 THEN -b.betrag ELSE 0 END)::float8 AS aus,
           SUM(CASE WHEN b.betrag > 0 THEN COALESCE(z.zu, 0) ELSE 0 END)::float8
                                                                   AS miete
      FROM buchung b
      LEFT JOIN (
            SELECT buchung_id, SUM(betrag) AS zu FROM zuordnung GROUP BY buchung_id
      ) z ON z.buchung_id = b.id
     WHERE b.buchungstag >= (date_trunc('month', CURRENT_DATE)
                             - interval '11 months')::date
     GROUP BY 1
     ORDER BY 1
  `);
  return cashflowReihe(zeilen, heute);
}

async function ladeLaeufe(): Promise<LaufZeile[]> {
  return query<LaufZeile>(`
    SELECT name, begonnen_am::text, ok, hinweise, ergebnis
      FROM lauf
     WHERE begonnen_am > now() - interval '30 days'
     ORDER BY begonnen_am DESC
     LIMIT 300
  `);
}

export interface UnzugeordnetLage {
  anzahl: number;
  summe: number;
  /** Eingänge, die der Höhe nach eine Monatsmiete sein könnten. */
  anzahlMietgross: number;
  summeMietgross: number;
  /** Eingänge über der höchsten Monatsmiete -- Finanzierung, Einlagen. */
  anzahlGross: number;
  summeGross: number;
  /** Die verwendete Grenze, damit sie auf der Karte genannt werden kann. */
  grenze: number;
}

/**
 * Teilt die Eingänge an der höchsten Monatsmiete.
 *
 * Grund: Auf dem Konto liegen neben Mieten auch die Darlehensauszahlung
 * (2,15 Mio.) und Gesellschaftereinlagen. Zusammengerechnet stand auf der
 * Karte eine Summe von 2,68 Mio. neben dem Satz "jeder einzelne davon kann
 * eine Miete sein". Das ist für 95 Prozent des Betrags falsch -- und eine
 * Karte, die so etwas behauptet, lehrt einen, sie zu überlesen. Genau
 * diese Karte darf man aber nicht überlesen: Ein nicht zugeordneter
 * Eingang ist der Fall, in dem das Geld da ist und die Verwaltung es nicht
 * sieht.
 *
 * Die Grenze ist nicht gewählt, sondern abgeleitet. Ein Betrag über der
 * höchsten vereinbarten Monatsmiete kann keine einzelne Monatsmiete sein.
 * Er kann eine Sammelzahlung mehrerer Monate sein -- darum heisst die
 * Spalte "könnte eine Miete sein" und nicht "ist keine".
 */
export function teileEingaenge(
  zeilen: Array<{ rest: number }>,
  grenze: number,
): UnzugeordnetLage {
  let anzahlMietgross = 0, summeMietgross = 0;
  let anzahlGross = 0, summeGross = 0;
  for (const z of zeilen) {
    // Ohne Grenze (keine Mietverhältnisse) gilt alles als mietgross: Dann
    // ist nichts bekannt, und eine Behauptung wäre schlechter als keine.
    if (grenze > 0 && z.rest > grenze) {
      anzahlGross++;
      summeGross += z.rest;
    } else {
      anzahlMietgross++;
      summeMietgross += z.rest;
    }
  }
  return {
    anzahl: zeilen.length,
    summe: runde(summeMietgross + summeGross),
    anzahlMietgross,
    summeMietgross: runde(summeMietgross),
    anzahlGross,
    summeGross: runde(summeGross),
    grenze: runde(grenze),
  };
}

async function ladeUnzugeordnet(): Promise<UnzugeordnetLage> {
  const [zeilen, grenze] = await Promise.all([
    query<{ rest: number }>(`
      SELECT (b.betrag - COALESCE(z.zu, 0))::float8 AS rest
        FROM buchung b
        LEFT JOIN (
              SELECT buchung_id, SUM(betrag) AS zu FROM zuordnung GROUP BY buchung_id
        ) z ON z.buchung_id = b.id
       WHERE b.betrag > 0
         AND b.betrag > COALESCE(z.zu, 0)
    `),
    hoechsteMonatsmiete(),
  ]);
  return teileEingaenge(
    zeilen.map((z) => ({ rest: Number(z.rest) })),
    grenze,
  );
}

export interface CockpitDaten {
  heute: string;
  fristen: FristLage[];
  monat: { monat: string; geld: MonatsGeld };
  rueckstaende: RueckstandsLage;
  /** Ist das Mahnwesen freigegeben? Ohne Freigabe geht nichts raus. */
  mahnwesenFreigegeben: boolean;
  /** Was auf eine Freigabe wartet -- Entwuerfe und unbeantwortete Vorgaenge. */
  freigaben: { entwuerfe: number; unbeantwortet: number };
  leerstand: LeerstandsLage;
  cashflow: CashflowBalken[];
  automatik: AutomatikPosten[];
  lagebericht: LageberichtLage;
  unzugeordnet: UnzugeordnetLage;
  /** Kennzahlen, die nicht gelesen werden konnten. Gehoert auf die Seite. */
  fehler: string[];
}

const LEER_MONAT: MonatsGeld = {
  anzahl: 0,
  soll: 0,
  bezahlt: 0,
  offen: 0,
  offenBetroffen: 0,
  nochNichtFaellig: 0,
  unabgeglichen: 0,
  unabgeglichenAnzahl: 0,
  belastbar: false,
};

const LEER_RUECKSTAND: RueckstandsLage = {
  zuSchreiben: 0,
  summe: 0,
  beobachten: 0,
  summeBeobachten: 0,
  ungeklaert: 0,
  summeUngeklaert: 0,
};

/** Alles, was das Cockpit braucht -- in einem Durchgang, parallel gelesen. */
/**
 * Wie viel wartet auf eine Freigabe?
 *
 * Das ist die handlungsnaechste Zahl der Startseite: ein Entwurf, der
 * liegen bleibt, ist eine Antwort, die niemand bekommt. Bisher stellte
 * die Freigabeliste ihre Abfragen selbst -- die Zahl stand damit erst
 * unten auf der Seite und nicht oben, wo man sie sucht.
 *
 * Gezaehlt wird in der Datenbank, nicht in der Komponente: Die Liste
 * holt hoechstens 50 Vorgaenge, die Zahl muss alle meinen.
 */
async function ladeFreigabestand(): Promise<{
  entwuerfe: number;
  unbeantwortet: number;
}> {
  const [e, u] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM nachricht WHERE status = 'entwurf'`,
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM vorgang v
        WHERE v.status = 'offen'
          AND NOT EXISTS (
            SELECT 1 FROM nachricht n
             WHERE n.vorgang_id = v.id
               AND n.status IN ('entwurf','gesendet'))`,
    ),
  ]);
  return { entwuerfe: e[0]?.n ?? 0, unbeantwortet: u[0]?.n ?? 0 };
}

export async function ladeCockpit(heute = new Date()): Promise<CockpitDaten> {
  const [
    fristen,
    monat,
    stand,
    frei,
    einheiten,
    cashflow,
    laeufe,
    unzugeordnet,
    freigaben,
  ] = await Promise.all([
    behutsam("Fristen", () => ladeFristen(heute), [] as FristLage[]),
    behutsam("Laufender Monat", () => ladeMonat(heute), {
      monat: monatsErster(heute),
      geld: LEER_MONAT,
    }),
    // Zurueckgestellte Faelle zaehlen hier nicht mit: Das Cockpit soll
    // zeigen, was zu tun ist, nicht was schon entschieden wurde. Sie
    // bleiben auf der Mahnseite im eigenen Abschnitt sichtbar.
    behutsam(
      "Rückstände",
      async () => {
        const zurueck = await zurueckgestellteIds(heute);
        return (await mahnstand(heute)).filter(
          (r) => !zurueck.has(r.mietverhaeltnis_id),
        );
      },
      [] as Rueckstand[],
    ),
    behutsam("Mahnfreigabe", freigabe, null),
    behutsam<{ stand: string; einheiten: EinheitLage[] }>(
      "Leerstand",
      verfuegbarkeit,
      { stand: isoTag(heute), einheiten: [] },
    ),
    behutsam("Cashflow", () => ladeCashflow(heute), [] as CashflowBalken[]),
    behutsam("Läufe", ladeLaeufe, [] as LaufZeile[]),
    behutsam("Zahlungseingänge", ladeUnzugeordnet, teileEingaenge([], 0)),
    behutsam("Freigaben", ladeFreigabestand, { entwuerfe: 0, unbeantwortet: 0 }),
  ]);

  return {
    heute: isoTag(heute),
    fristen: fristen.wert,
    monat: monat.wert,
    rueckstaende: stand.fehler ? LEER_RUECKSTAND : rueckstandsLage(stand.wert),
    mahnwesenFreigegeben: frei.wert !== null,
    leerstand: leerstandsLage(einheiten.wert.einheiten, heute),
    cashflow: cashflow.wert,
    automatik: automatikLage(laeufe.wert, ERWARTETE_LAEUFE, heute),
    lagebericht: lageberichtLage(laeufe.wert, heute),
    unzugeordnet: unzugeordnet.wert,
    freigaben: freigaben.wert,
    fehler: [
      fristen.fehler,
      monat.fehler,
      stand.fehler,
      frei.fehler,
      einheiten.fehler,
      cashflow.fehler,
      laeufe.fehler,
      unzugeordnet.fehler,
      freigaben.fehler,
    ].filter((f): f is string => f !== null),
  };
}
