import { dritterWerktag } from "./mahnstufen";
import { monatsStatus, type ZahlStatus } from "./mieter";

/**
 * Das Mietenbuch: welche Einheit war in welchem Monat an wen vermietet, zu
 * welchem Betrag, und was ist davon angekommen.
 *
 * Diese Datei rechnet und liest nichts aus der Datenbank. Das ist Absicht:
 * Das Raster beantwortet die Frage, ob jemand zu wenig gezahlt hat, und je
 * Zelle steht am Ende eine Farbe, die als Vorwurf gelesen wird. Jede
 * Verzweigung muss sich ohne laufende Datenbank prüfen lassen.
 *
 * Zwei Entscheidungen sind nicht hier getroffen und werden hier auch nicht
 * nachgebaut:
 *
 *   1. Der Zahlungsstand eines Monats kommt aus `monatsStatus` (lib/mieter.ts).
 *      Dort steht die Reihenfolge, auf die es ankommt -- insbesondere, dass
 *      ein Monat ohne Kontodaten **nie** als offen erscheint. Diese Datei
 *      ruft die Funktion auf, statt die Reihenfolge zu wiederholen.
 *
 *   2. Der Sollbetrag folgt der Formel aus lib/rueckstaende.ts:
 *      COALESCE(gesamtmiete, kaltmiete + nebenkosten + moeblierungszuschlag),
 *      genommen aus der jüngsten Mietanpassung, die im Monat schon galt,
 *      sonst vom Mietverhältnis selbst.
 *
 * Was hier dazukommt und im Mahnwesen fehlt, ist die Zeitachse und die
 * Belegung: ein leerer Monat ist kein Rückstand, und ein nicht abgeglichener
 * Monat ist keiner von beidem.
 */

// ---------------------------------------------------------------------------
// Zeitraum
// ---------------------------------------------------------------------------

/** Erster des Monats, in dem dieser Tag liegt. */
export function monatsAnfang(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

/** Letzter Tag des Monats, ISO. */
export function monatsEnde(monat: string): string {
  const [j, m] = monat.slice(0, 7).split("-").map(Number);
  // Tag 0 des Folgemonats ist der Letzte dieses Monats.
  const d = new Date(Date.UTC(j, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Verschiebt einen Monatsersten um n Monate. */
export function monatPlus(monat: string, n: number): string {
  const [j, m] = monat.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Die letzten `anzahl` Monate bis einschliesslich des Monats von `bis`.
 *
 * Aufsteigend, damit die Spalten von links nach rechts in der Zeit laufen --
 * so liest man ein Hausbuch.
 */
export function letzteMonate(bis: Date, anzahl = 12): string[] {
  const ende = monatsAnfang(bis.toISOString().slice(0, 10));
  const monate: string[] = [];
  for (let i = anzahl - 1; i >= 0; i--) monate.push(monatPlus(ende, -i));
  return monate;
}

/** Die zwölf Monate eines Kalenderjahres. */
export function kalenderjahr(jahr: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${jahr}-${String(i + 1).padStart(2, "0")}-01`,
  );
}

// ---------------------------------------------------------------------------
// Eingangsdaten -- genau das, was die Abfragen liefern
// ---------------------------------------------------------------------------

export interface EinheitZeile {
  id: string;
  objekt_id: string;
  objekt_name: string;
  /** Beginn der Kontodaten des Objekts. NULL = keine Kontodaten. */
  zahlungsdaten_ab: string | null;
  bezeichnung: string;
  schluessel: string | null;
  etage: string | null;
  art: string;
  /** Übergeordnete Einheit (Etage/WG), wenn die Einheit ein Zimmer darin ist. */
  eltern_id: string | null;
  eltern_bezeichnung: string | null;
  /** Hat diese Einheit selbst Zimmer unter sich? */
  hat_kinder: boolean;
  vermarktung: string;
  /**
   * Ist die Belegung dieser Einheit nachweislich gepflegt?
   *
   * Steht false, heisst "kein Mietverhältnis" **nicht** "frei", sondern
   * "nicht erfasst" -- es gibt Altmieter ohne Datensatz. Dieselbe Regel wie
   * in lib/oeffentlich.ts, aus demselben Grund: Im September 2026 hat die
   * Website bewohnte Zimmer als frei angeboten.
   */
  belegung_gepflegt: boolean;
}

export interface MietverhaeltnisZeile {
  id: string;
  einheit_id: string;
  kontakt_name: string;
  beginn: string;
  ende: string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierungszuschlag: string | null;
  gesamtmiete: string | null;
  kaution: string | null;
}

export interface AnpassungZeile {
  mietverhaeltnis_id: string;
  gilt_ab: string;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierungszuschlag: string | null;
  gesamtmiete: string | null;
}

/** Eine gestellte Monatsmiete samt dem, was ihr zugeordnet ist. */
export interface SollZeile {
  mietverhaeltnis_id: string;
  monat: string;
  betrag: string;
  gezahlt: string | null;
  gezahlt_am: string | null;
}

export interface Rasterdaten {
  einheiten: EinheitZeile[];
  mietverhaeltnisse: MietverhaeltnisZeile[];
  anpassungen: AnpassungZeile[];
  sollstellungen: SollZeile[];
  /** Gibt es überhaupt eingelesene Kontoumsätze? */
  buchungen_vorhanden: boolean;
  monate: string[];
  heute: Date;
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

/** Die sechs Zustände einer Zelle. "leer" heisst: kein Mietverhältnis. */
export type ZellStatus = ZahlStatus | "leer";

/**
 * Warum eine Zelle leer ist. Nur `frei` ist Leerstand.
 *
 * `eltern`  -- das Zimmer ist über den Vertrag der ganzen Etage belegt.
 *              Im 2. OG läuft ein Altmietverhältnis über fünf Zimmer; ohne
 *              diesen Fall stünden sie fünfmal als Leerstand im Buch.
 * `unbekannt` -- Belegung nicht gepflegt, es kann ein Altmieter drin sitzen.
 * `nicht_vermietbar` -- wird nicht angeboten (Gewerbefläche).
 */
export type LeerGrund = "frei" | "eltern" | "unbekannt" | "nicht_vermietbar";

export type SollQuelle =
  | "sollstellung"
  | "anpassung"
  | "mietverhaeltnis"
  | "unbekannt";

/** Ein Mietverhältnis in einem Monat einer Einheit. */
export interface Abschnitt {
  mietverhaeltnis_id: string;
  kontakt_name: string;
  soll: number;
  gezahlt: number;
  status: Exclude<ZellStatus, "leer">;
  quelle: SollQuelle;
  /** Erster und letzter Miettag in diesem Monat, wenn nicht der ganze. */
  ab: string | null;
  bis: string | null;
  /** Keine Miete hinterlegt -- dann wird nichts behauptet. */
  miete_unbekannt: boolean;
  /** Kalt-/Nebenkostenanteil, sofern er aus dem Vertrag hervorgeht. */
  kaltmiete: number | null;
  nebenkosten: number | null;
}

export interface Zelle {
  monat: string;
  einheit_id: string;
  /** Die Mietverhältnisse des Monats. Mehr als eines = Wechsel im Monat. */
  abschnitte: Abschnitt[];
  /** Der auffälligste Zustand der Zelle -- die Farbe richtet sich danach. */
  status: ZellStatus;
  leer_grund: LeerGrund | null;
  soll: number;
  gezahlt: number;
}

export interface Summe {
  /** Alles, was gestellt bzw. vertraglich erwartet ist. */
  soll: number;
  /** Alles, was zugeordnet ist. */
  ist: number;
  /**
   * Nur die Monate, die sich vergleichen lassen: fällig **und** von
   * Kontodaten gedeckt. Alles andere bleibt draussen -- siehe abweichung.
   */
  soll_vergleich: number;
  ist_vergleich: number;
  /**
   * ist_vergleich - soll_vergleich. Negativ heisst: es fehlt etwas.
   *
   * Monate ohne Kontodaten und noch nicht fällige Monate zählen hier
   * **nicht** mit. Täten sie es, hätte die Welserstraße eine Abweichung von
   * über zwanzig Monatsmieten, obwohl niemand etwas schuldet -- die Mieten
   * vor dem Kontobeginn flossen dem Voreigentümer zu.
   */
  abweichung: number;
  /** Soll aus Monaten ohne Kontodaten. Unbekannt, nicht unbezahlt. */
  soll_ohne_daten: number;
  /** Soll aus Monaten, die noch nicht fällig sind. */
  soll_nicht_faellig: number;
  /** Aufteilung des Solls, soweit sie aus den Verträgen hervorgeht. */
  kaltmiete: number;
  nebenkosten: number;
  /** Soll ohne Aufteilung: Inklusivmieten und anteilige Monate. */
  nicht_aufgeteilt: number;
  monate_belegt: number;
  /** Nur echter Leerstand. Nicht erfasste und über die Etage belegte zählen nicht. */
  monate_leer: number;
  /** Zellen, die für die Quote überhaupt in Frage kommen. */
  monate_vermietbar: number;
  /** monate_leer / monate_vermietbar. null = keine Aussage möglich. */
  leerstandsquote: number | null;
}

export interface RasterZeile {
  einheit: EinheitZeile;
  /** Anzeigezeile: "Zimmer 1.3 · 1. OG · 5er-WG 1. OG". */
  bezeichnung: string;
  untertitel: string;
  zellen: Zelle[];
  summe: Summe;
  /** Kaution des jüngsten Mietverhältnisses im Zeitraum. */
  kaution: number | null;
}

export interface Gruppe {
  objekt_id: string;
  objekt_name: string;
  zahlungsdaten_ab: string | null;
  zeilen: RasterZeile[];
  /** Je Monat eine Summe -- die Spaltenfüsse. */
  spalten: Summe[];
  summe: Summe;
}

export interface Raster {
  monate: string[];
  gruppen: Gruppe[];
  spalten: Summe[];
  summe: Summe;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function zahl(wert: string | number | null | undefined): number | null {
  if (wert === null || wert === undefined || wert === "") return null;
  const n = Number(wert);
  return Number.isFinite(n) ? n : null;
}

function cent(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Gilt dieses Mietverhältnis in diesem Monat?
 *
 * beginn <= Monatsende UND (ende IS NULL ODER ende >= Monatsanfang). Ein
 * Vertrag, der am 20. beginnt, gilt im Monat; einer, der am 10. endet,
 * ebenfalls. Beide zusammen ergeben den Wechsel mitten im Monat.
 */
export function giltImMonat(
  mv: { beginn: string; ende: string | null },
  monat: string,
): boolean {
  const anfang = monatsAnfang(monat);
  const ende = monatsEnde(monat);
  if (mv.beginn > ende) return false;
  if (mv.ende !== null && mv.ende < anfang) return false;
  return true;
}

/** Die Posten zu einem Betrag, nach der Formel aus lib/rueckstaende.ts. */
function betragAus(p: {
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierungszuschlag: string | null;
  gesamtmiete: string | null;
}): number | null {
  const gesamt = zahl(p.gesamtmiete);
  // COALESCE: die zugesagte Gesamtmiete gewinnt, wenn sie gesetzt ist --
  // geschuldet ist, was im Vertrag steht, nicht die Summe der Herleitung.
  if (gesamt !== null) return cent(gesamt);
  const k = zahl(p.kaltmiete) ?? 0;
  const n = zahl(p.nebenkosten) ?? 0;
  const m = zahl(p.moeblierungszuschlag) ?? 0;
  return cent(k + n + m);
}

/**
 * Welcher Betrag galt in diesem Monat -- und woher er kommt.
 *
 * Die jüngste Mietanpassung mit gilt_ab <= Monatsanfang, sonst die Werte am
 * Mietverhältnis. Genau die Reihenfolge aus lib/rueckstaende.ts; dort wird
 * gegen `date_trunc('month', CURRENT_DATE)` verglichen, also gegen den
 * Monatsersten und nicht gegen den Tag.
 *
 * Ohne diese Zeitachse bekäme jeder Monat seit 2024 den heutigen Betrag --
 * bei einer Erhöhung zum 01.07.2026 wären das zweieinhalb Jahre zu viel
 * gestellte Miete (siehe db/022).
 */
export function sollLautVertrag(
  mv: MietverhaeltnisZeile,
  anpassungen: AnpassungZeile[],
  monat: string,
): { betrag: number | null; quelle: SollQuelle; kaltmiete: number | null; nebenkosten: number | null } {
  const anfang = monatsAnfang(monat);
  let jüngste: AnpassungZeile | null = null;
  for (const a of anpassungen) {
    if (a.mietverhaeltnis_id !== mv.id) continue;
    if (a.gilt_ab > anfang) continue;
    if (jüngste === null || a.gilt_ab > jüngste.gilt_ab) jüngste = a;
  }

  const quelle = jüngste ? ("anpassung" as const) : ("mietverhaeltnis" as const);
  const posten = jüngste ?? mv;
  const betrag = betragAus(posten);
  return {
    betrag,
    quelle,
    kaltmiete: zahl(posten.kaltmiete),
    nebenkosten: zahl(posten.nebenkosten),
  };
}

/**
 * Liegen für diesen Monat Kontodaten vor?
 *
 * Wörtlich dieselbe Bedingung wie in der Abfrage von `zahlungsstand`
 * (lib/mieter.ts): kein Datum am Objekt, Monat vor dem Beginn der
 * Kontodaten, oder es sind überhaupt keine Buchungen eingelesen.
 *
 * Für die Welserstraße steht das Datum auf dem 31.07.2025, abgerechnet wird
 * ab Januar 2024. Es gibt dort also neunzehn nicht abgeglichene Monate, und
 * das ist richtig so.
 */
export function ohneZahlungsdaten(
  monat: string,
  zahlungsdatenAb: string | null,
  buchungenVorhanden: boolean,
): boolean {
  if (!buchungenVorhanden) return true;
  if (zahlungsdatenAb === null) return true;
  return monatsAnfang(monat) < monatsAnfang(zahlungsdatenAb);
}

/** Hausordnung: EG unten, DG oben, Unbekanntes zuletzt. */
export function etagenRang(etage: string | null): number {
  if (etage === null || etage.trim() === "") return 900;
  const e = etage.toLowerCase();
  if (e.includes("ug")) return 0;
  if (e.includes("eg")) return 1;
  const og = e.match(/(\d+)\s*\.?\s*og/);
  if (og) return 10 + Number(og[1]);
  if (e.includes("dg")) return 500;
  return 800;
}

/**
 * Natürliche Reihenfolge für Bezeichnungen: "Zimmer 2" vor "Zimmer 10".
 *
 * Reine Textsortierung stellt "Zimmer 10" vor "Zimmer 2" -- im Hausbuch
 * stünde die Zehn dann zwischen Eins und Zwei.
 */
function natuerlich(a: string, b: string): number {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

/** Zeilenreihenfolge: Etage, dann Bezeichnung natürlich sortiert. */
export function vergleicheEinheiten(a: EinheitZeile, b: EinheitZeile): number {
  const re = etagenRang(a.etage) - etagenRang(b.etage);
  if (re !== 0) return re;
  return natuerlich(a.bezeichnung, b.bezeichnung);
}

/**
 * Welcher Zustand bestimmt die Farbe einer Zelle mit mehreren Abschnitten?
 *
 * Von auffällig nach unauffällig. Bei einem Wechsel mitten im Monat, bei dem
 * der eine gezahlt und der andere nicht hat, muss das Offene gewinnen --
 * sonst verschwindet es hinter dem bezahlten Teil.
 */
const RANG: Record<ZellStatus, number> = {
  offen: 0,
  teilweise: 1,
  nicht_abgeglichen: 2,
  nicht_faellig: 3,
  bezahlt: 4,
  leer: 5,
};

function schwerster(stati: ZellStatus[]): ZellStatus {
  return stati.reduce(
    (a, b) => (RANG[b] < RANG[a] ? b : a),
    "bezahlt" as ZellStatus,
  );
}

/**
 * Warum ist diese Einheit in diesem Monat ohne Mietverhältnis?
 *
 * Die Reihenfolge ist von "erklärt" nach "echter Leerstand". Nur der letzte
 * Zweig ist Leerstand und zählt in die Quote; die anderen sind Hinweise,
 * nicht Lücken im Cashflow.
 */
function leerGrund(
  e: EinheitZeile,
  elternBelegt: boolean,
): LeerGrund {
  if (elternBelegt) return "eltern";
  if (e.vermarktung === "nicht_anbieten") return "nicht_vermietbar";
  if (!e.belegung_gepflegt) return "unbekannt";
  return "frei";
}

// ---------------------------------------------------------------------------
// Zelle
// ---------------------------------------------------------------------------

export interface ZellEingang {
  monat: string;
  einheit: EinheitZeile;
  /** Mietverhältnisse, die in diesem Monat für DIESE Einheit gelten. */
  mietverhaeltnisse: MietverhaeltnisZeile[];
  anpassungen: AnpassungZeile[];
  /** Gestellte Monatsmieten, Schlüssel "<mv-id>|<monat>". */
  gestellt: Map<string, SollZeile>;
  /** Läuft in diesem Monat ein Vertrag über die übergeordnete Einheit? */
  eltern_belegt: boolean;
  buchungen_vorhanden: boolean;
  heute: Date;
}

/**
 * Eine Zelle des Mietenbuchs. Reine Funktion.
 *
 * Der Zustand wird **nicht** hier gerechnet: Für jeden gestellten Monat
 * entscheidet `monatsStatus` aus lib/mieter.ts, und zwar mit demselben
 * Fälligkeitstag (dritter Werktag, § 556b Abs. 1 BGB) wie das Mahnwesen.
 *
 * Nur zwei Fälle kommen hinzu, die es dort nicht gibt:
 *   - kein Mietverhältnis  -> leer, mit Grund
 *   - Mietverhältnis ohne gestellte Miete -> nicht fällig (Zukunft) oder
 *     nicht abgeglichen (Vergangenheit). Nie offen: Was nicht gestellt ist,
 *     ist nicht gefordert.
 */
export function baueZelle(ein: ZellEingang): Zelle {
  const { monat, einheit } = ein;

  if (ein.mietverhaeltnisse.length === 0) {
    return {
      monat,
      einheit_id: einheit.id,
      abschnitte: [],
      status: "leer",
      leer_grund: leerGrund(einheit, ein.eltern_belegt),
      soll: 0,
      gezahlt: 0,
    };
  }

  const ohneDaten = ohneZahlungsdaten(
    monat,
    einheit.zahlungsdaten_ab,
    ein.buchungen_vorhanden,
  );
  const [j, m] = monat.slice(0, 7).split("-").map(Number);
  const faellig = dritterWerktag(j, m);
  const anfang = monatsAnfang(monat);
  const ende = monatsEnde(monat);

  const abschnitte: Abschnitt[] = ein.mietverhaeltnisse
    .slice()
    .sort((a, b) => a.beginn.localeCompare(b.beginn))
    .map((mv) => {
      const vertrag = sollLautVertrag(mv, ein.anpassungen, monat);
      const zeile = ein.gestellt.get(`${mv.id}|${anfang}`);

      // Ein- und Auszug innerhalb des Monats sichtbar machen.
      const ab = mv.beginn > anfang ? mv.beginn : null;
      const bis = mv.ende !== null && mv.ende < ende ? mv.ende : null;

      if (zeile) {
        // Gestellt ist gestellt: Der Betrag aus der Sollstellung gilt, auch
        // wenn er anteilig ist. Ihn aus dem Vertrag neu zu rechnen würde aus
        // einem halben Monat eine ganze Monatsmiete machen.
        const stand = monatsStatus(
          {
            monat: anfang,
            soll: zeile.betrag,
            gezahlt: zeile.gezahlt,
            gezahlt_am: zeile.gezahlt_am,
            ohne_zahlungsdaten: ohneDaten,
          },
          faellig,
          ein.heute,
        );
        const voll =
          vertrag.betrag !== null && cent(vertrag.betrag) === cent(stand.soll);
        return {
          mietverhaeltnis_id: mv.id,
          kontakt_name: mv.kontakt_name,
          soll: stand.soll,
          gezahlt: stand.gezahlt,
          status: stand.status,
          quelle: "sollstellung" as SollQuelle,
          ab,
          bis,
          miete_unbekannt: false,
          // Die Aufteilung gilt nur für den ganzen Monat. Bei einem
          // anteiligen Betrag wäre jede Aufteilung erfunden.
          kaltmiete: voll ? vertrag.kaltmiete : null,
          nebenkosten: voll ? vertrag.nebenkosten : null,
        };
      }

      // Nichts gestellt. Das ist der Normalfall für künftige Monate und für
      // Altmietverhältnisse vor `abrechnung_ab`.
      const betrag = vertrag.betrag;
      const unbekannt = betrag === null || betrag <= 0;
      const status: Exclude<ZellStatus, "leer"> = unbekannt
        ? // Ohne hinterlegte Miete wird nichts behauptet -- weder "bezahlt"
          // (ein Soll von 0 ist immer gedeckt) noch "offen". Dieselbe
          // Notbremse wie in lib/mahnstufen.ts.
          "nicht_abgeglichen"
        : ein.heute < faellig
          ? "nicht_faellig"
          : "nicht_abgeglichen";

      return {
        mietverhaeltnis_id: mv.id,
        kontakt_name: mv.kontakt_name,
        soll: unbekannt ? 0 : cent(betrag!),
        gezahlt: 0,
        status,
        quelle: unbekannt ? ("unbekannt" as SollQuelle) : vertrag.quelle,
        ab,
        bis,
        miete_unbekannt: unbekannt,
        kaltmiete: unbekannt ? null : vertrag.kaltmiete,
        nebenkosten: unbekannt ? null : vertrag.nebenkosten,
      };
    });

  return {
    monat,
    einheit_id: einheit.id,
    abschnitte,
    status: schwerster(abschnitte.map((a) => a.status)),
    leer_grund: null,
    soll: cent(abschnitte.reduce((s, a) => s + a.soll, 0)),
    gezahlt: cent(abschnitte.reduce((s, a) => s + a.gezahlt, 0)),
  };
}

// ---------------------------------------------------------------------------
// Summen
// ---------------------------------------------------------------------------

/** Zustände, die sich vergleichen lassen: fällig und von Kontodaten gedeckt. */
const VERGLEICHBAR = new Set<ZellStatus>(["bezahlt", "teilweise", "offen"]);

export function leereSumme(): Summe {
  return {
    soll: 0,
    ist: 0,
    soll_vergleich: 0,
    ist_vergleich: 0,
    abweichung: 0,
    soll_ohne_daten: 0,
    soll_nicht_faellig: 0,
    kaltmiete: 0,
    nebenkosten: 0,
    nicht_aufgeteilt: 0,
    monate_belegt: 0,
    monate_leer: 0,
    monate_vermietbar: 0,
    leerstandsquote: null,
  };
}

/**
 * Summiert Zellen -- für eine Zeile, eine Spalte oder das ganze Objekt.
 *
 * Die Abweichung entsteht nur aus vergleichbaren Monaten. Was nicht
 * abgeglichen oder noch nicht fällig ist, steht daneben und wird nicht
 * gegengerechnet; die Begründung steht an `Summe.abweichung`.
 */
export function summiere(zellen: Zelle[], vermietbar: (z: Zelle) => boolean): Summe {
  const s = leereSumme();

  for (const z of zellen) {
    s.soll += z.soll;
    s.ist += z.gezahlt;

    if (z.status === "leer") {
      if (vermietbar(z)) {
        s.monate_vermietbar++;
        if (z.leer_grund === "frei") s.monate_leer++;
      }
      continue;
    }

    s.monate_belegt++;
    if (vermietbar(z)) s.monate_vermietbar++;

    for (const a of z.abschnitte) {
      if (VERGLEICHBAR.has(a.status)) {
        s.soll_vergleich += a.soll;
        s.ist_vergleich += a.gezahlt;
      } else if (a.status === "nicht_faellig") {
        s.soll_nicht_faellig += a.soll;
      } else {
        s.soll_ohne_daten += a.soll;
      }

      if (a.kaltmiete !== null || a.nebenkosten !== null) {
        s.kaltmiete += a.kaltmiete ?? 0;
        s.nebenkosten += a.nebenkosten ?? 0;
        const rest = a.soll - (a.kaltmiete ?? 0) - (a.nebenkosten ?? 0);
        // Der Rest ist der Möblierungszuschlag oder eine Abweichung zur
        // zugesagten Gesamtmiete. Er gehört zum Soll, aber nicht in die
        // beiden Spalten, in denen der Eigentümer heute Kalt und BK liest.
        if (Math.abs(rest) >= 0.01) s.nicht_aufgeteilt += rest;
      } else {
        s.nicht_aufgeteilt += a.soll;
      }
    }
  }

  for (const k of [
    "soll",
    "ist",
    "soll_vergleich",
    "ist_vergleich",
    "soll_ohne_daten",
    "soll_nicht_faellig",
    "kaltmiete",
    "nebenkosten",
    "nicht_aufgeteilt",
  ] as const) {
    s[k] = cent(s[k]);
  }
  s.abweichung = cent(s.ist_vergleich - s.soll_vergleich);
  s.leerstandsquote =
    s.monate_vermietbar > 0 ? s.monate_leer / s.monate_vermietbar : null;
  return s;
}

/** Addiert mehrere Summen -- für Objekt- und Gesamtfüsse. */
export function addiereSummen(teile: Summe[]): Summe {
  const s = leereSumme();
  for (const t of teile) {
    s.soll += t.soll;
    s.ist += t.ist;
    s.soll_vergleich += t.soll_vergleich;
    s.ist_vergleich += t.ist_vergleich;
    s.soll_ohne_daten += t.soll_ohne_daten;
    s.soll_nicht_faellig += t.soll_nicht_faellig;
    s.kaltmiete += t.kaltmiete;
    s.nebenkosten += t.nebenkosten;
    s.nicht_aufgeteilt += t.nicht_aufgeteilt;
    s.monate_belegt += t.monate_belegt;
    s.monate_leer += t.monate_leer;
    s.monate_vermietbar += t.monate_vermietbar;
  }
  for (const k of [
    "soll",
    "ist",
    "soll_vergleich",
    "ist_vergleich",
    "soll_ohne_daten",
    "soll_nicht_faellig",
    "kaltmiete",
    "nebenkosten",
    "nicht_aufgeteilt",
  ] as const) {
    s[k] = cent(s[k]);
  }
  s.abweichung = cent(s.ist_vergleich - s.soll_vergleich);
  s.leerstandsquote =
    s.monate_vermietbar > 0 ? s.monate_leer / s.monate_vermietbar : null;
  return s;
}

// ---------------------------------------------------------------------------
// Das ganze Raster
// ---------------------------------------------------------------------------

/**
 * Zählt eine Zelle in die Leerstandsquote?
 *
 * Nur Einheiten, die überhaupt einzeln vermietet werden und deren Belegung
 * gepflegt ist. Alles andere würde die Quote nach oben treiben, ohne dass
 * ein Zimmer leer steht: die Gewerbefläche, die nicht angeboten wird; die
 * WG-Etage, die nur Hülle für ihre Zimmer ist; und jede Einheit, bei der
 * "kein Mietverhältnis" bloss heisst, dass der Altmieter nicht erfasst ist.
 */
export function istVermietbar(e: EinheitZeile): boolean {
  if (e.art === "gemeinschaft") return false;
  if (e.hat_kinder) return false;
  if (e.vermarktung === "nicht_anbieten") return false;
  return e.belegung_gepflegt;
}

/**
 * Welche Einheiten bekommen eine Zeile?
 *
 * Jede einzeln vermietbare Einheit -- und zusätzlich jede, die im Zeitraum
 * ein Mietverhältnis hatte. Der zweite Teil ist wichtig: Im 2. OG läuft ein
 * Vertrag über die ganze Etage. Ohne diese Zeile stünde die Miete dafür in
 * keiner Spalte, und das Buch wäre um eine ganze Etage zu leicht.
 */
function istZeile(e: EinheitZeile, mitVertrag: Set<string>): boolean {
  if (mitVertrag.has(e.id)) return true;
  if (e.art === "gemeinschaft") return false;
  if (e.hat_kinder) return false;
  return true;
}

export function baueRaster(d: Rasterdaten): Raster {
  const monate = d.monate;

  // Mietverhältnisse je Einheit, einmal gruppiert statt je Zelle gesucht.
  const jeEinheit = new Map<string, MietverhaeltnisZeile[]>();
  for (const mv of d.mietverhaeltnisse) {
    const liste = jeEinheit.get(mv.einheit_id) ?? [];
    liste.push(mv);
    jeEinheit.set(mv.einheit_id, liste);
  }

  const gestellt = new Map<string, SollZeile>();
  for (const s of d.sollstellungen) {
    gestellt.set(`${s.mietverhaeltnis_id}|${monatsAnfang(s.monat)}`, s);
  }

  const mitVertrag = new Set(jeEinheit.keys());
  const zeilenEinheiten = d.einheiten.filter((e) => istZeile(e, mitVertrag));

  const nachObjekt = new Map<string, EinheitZeile[]>();
  for (const e of zeilenEinheiten) {
    const liste = nachObjekt.get(e.objekt_id) ?? [];
    liste.push(e);
    nachObjekt.set(e.objekt_id, liste);
  }

  const vermietbarJeEinheit = new Map(
    d.einheiten.map((e) => [e.id, istVermietbar(e)]),
  );
  const vermietbar = (z: Zelle) => vermietbarJeEinheit.get(z.einheit_id) === true;

  const gruppen: Gruppe[] = [...nachObjekt.entries()]
    .map(([objekt_id, einheiten]) => {
      const sortiert = einheiten.slice().sort(vergleicheEinheiten);

      const zeilen: RasterZeile[] = sortiert.map((e) => {
        const eigene = jeEinheit.get(e.id) ?? [];
        const ueberEltern =
          e.eltern_id !== null ? (jeEinheit.get(e.eltern_id) ?? []) : [];

        const zellen = monate.map((monat) =>
          baueZelle({
            monat,
            einheit: e,
            mietverhaeltnisse: eigene.filter((mv) => giltImMonat(mv, monat)),
            anpassungen: d.anpassungen,
            gestellt,
            eltern_belegt: ueberEltern.some((mv) => giltImMonat(mv, monat)),
            buchungen_vorhanden: d.buchungen_vorhanden,
            heute: d.heute,
          }),
        );

        // Kaution des jüngsten Mietverhältnisses im Zeitraum -- die Spalte
        // im Mietenbuch des Eigentümers trägt genau eine Zahl je Einheit.
        const imZeitraum = eigene
          .filter((mv) => monate.some((m) => giltImMonat(mv, m)))
          .sort((a, b) => a.beginn.localeCompare(b.beginn));
        const letztes = imZeitraum[imZeitraum.length - 1];

        return {
          einheit: e,
          bezeichnung: e.bezeichnung,
          untertitel: [e.etage, e.eltern_bezeichnung]
            .filter((t): t is string => !!t && t !== e.bezeichnung)
            .join(" · "),
          zellen,
          summe: summiere(zellen, vermietbar),
          kaution: letztes ? zahl(letztes.kaution) : null,
        };
      });

      const spalten = monate.map((_, i) =>
        summiere(
          zeilen.map((z) => z.zellen[i]),
          vermietbar,
        ),
      );

      return {
        objekt_id,
        objekt_name: einheiten[0].objekt_name,
        zahlungsdaten_ab: einheiten[0].zahlungsdaten_ab,
        zeilen,
        spalten,
        summe: addiereSummen(zeilen.map((z) => z.summe)),
      };
    })
    .sort((a, b) => natuerlich(a.objekt_name, b.objekt_name));

  return {
    monate,
    gruppen,
    spalten: monate.map((_, i) => addiereSummen(gruppen.map((g) => g.spalten[i]))),
    summe: addiereSummen(gruppen.map((g) => g.summe)),
  };
}

/** Wie viele Einheitszeilen stehen im Raster? */
export function zeilenZahl(raster: Raster): number {
  return raster.gruppen.reduce((n, g) => n + g.zeilen.length, 0);
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------
//
// Bei drei Häusern hat das Raster über fünfzig Zeilen. Der Eigentümer will
// auf eine Einheit, ein Haus oder eine Gruppe eingrenzen können.
//
// Der Filter arbeitet auf dem **fertigen** Raster und rechnet Spaltenfüsse
// und Gesamtsummen neu. Das ist der ganze Punkt: Ein Filter, der nur Zeilen
// ausblendet und die alten Summen stehen lässt, zeigt eine Summe über
// Zeilen, die man nicht sieht -- und aus dieser Zahl entsteht später ein
// Mahnschreiben. Gefiltert wird deshalb nicht in der Darstellung, sondern
// hier, mit denselben Funktionen, die auch `baueRaster` benutzt
// (`summiere` / `addiereSummen`).

export type Nutzungsart = "wohnen" | "gewerbe";

/** Eingrenzung auf auffällige Zeilen. */
export type NurFilter = "abweichung" | "leerstand";

export interface Mietenbuchfilter {
  /** Kennung eines Objekts, oder null für alle. */
  objekt: string | null;
  /**
   * Freitext auf Einheitsbezeichnung, Etage, übergeordnete Einheit (WG) und
   * Mietername. So getippt wie eingegeben; kleingeschrieben wird beim
   * Vergleichen, damit in der Adresse und im Feld steht, was der Nutzer
   * geschrieben hat.
   */
  suche: string;
  art: Nutzungsart | null;
  nur: NurFilter | null;
}

/** Werte aus `searchParams` -- ein Parameter kann mehrfach vorkommen. */
export type Suchparameter = Record<string, string | string[] | undefined>;

export function leererFilter(): Mietenbuchfilter {
  return { objekt: null, suche: "", art: null, nur: null };
}

/** Greift überhaupt etwas? Entscheidet, ob die Seite "Ausschnitt" sagt. */
export function filterGesetzt(f: Mietenbuchfilter): boolean {
  return f.objekt !== null || f.suche !== "" || f.art !== null || f.nur !== null;
}

/**
 * Kleinschreibung zum Vergleichen.
 *
 * Mit Gebietsangabe: ohne sie entscheidet die Umgebung des Servers, was aus
 * einem "İ" wird. Im Mietenbuch stehen Namen aus mehreren Sprachen.
 */
function klein(t: string): string {
  return t.toLocaleLowerCase("de-DE");
}

/** Der erste Wert eines Suchparameters; aus `?a=1&a=2` wird "1". */
function einWert(w: string | string[] | undefined): string {
  if (w === undefined) return "";
  const t = Array.isArray(w) ? (w[0] ?? "") : w;
  return t.trim();
}

/**
 * Macht aus Suchparametern einen geprüften Filter. Alles Unbekannte fällt
 * weg.
 *
 * `objekt` wird gegen die Objekte geprüft, die es im Raster wirklich gibt --
 * nicht gegen die Form einer Kennung. Eine Kennung, die zu keinem Objekt
 * gehört, filtert deshalb **nicht** "nichts", sondern wird ignoriert: Ein
 * veralteter Verweis oder ein Tippfehler in der Adresse zeigt dann das ganze
 * Buch und nicht eine leere Seite, auf der man den Leerstand einer Lücke in
 * der Adresse zuschreibt.
 *
 * Das heisst auch: Angeboten werden kann nur, was im Raster steht. Ein
 * Objekt, das im gewählten Zeitraum keine Zeile hat, lässt sich nicht
 * wählen -- es stünde auch in keiner Liste.
 */
export function lesefilter(
  params: Suchparameter,
  bekannteObjekte: Iterable<string> = [],
): Mietenbuchfilter {
  const objekte = new Set(bekannteObjekte);

  const objekt = einWert(params.objekt);
  const art = einWert(params.art);
  const nur = einWert(params.nur);

  return {
    objekt: objekte.has(objekt) ? objekt : null,
    // Die Suche wird nicht geprüft, sondern nur beschnitten: Jeder Text ist
    // eine zulässige Suche, auch ein einzelnes Zeichen ("2" sucht Zimmer 2).
    // Trifft er nichts, sagt die Seite "kein Treffer" -- das ist die
    // richtige Antwort und kein Fehler.
    suche: einWert(params.suche),
    art: art === "wohnen" || art === "gewerbe" ? art : null,
    nur: nur === "abweichung" || nur === "leerstand" ? nur : null,
  };
}

/**
 * Die Adresse zu einem Filter. Leere Teile stehen nicht in der Adresse --
 * so bleibt ein ungefilterter Blick `/mietenbuch` und lässt sich
 * weitergeben, speichern und ausdrucken.
 */
export function mietenbuchAdresse(
  filter: Mietenbuchfilter,
  jahr: number | null,
): string {
  const p = new URLSearchParams();
  if (jahr !== null) p.set("jahr", String(jahr));
  if (filter.objekt !== null) p.set("objekt", filter.objekt);
  if (filter.suche !== "") p.set("suche", filter.suche);
  if (filter.art !== null) p.set("art", filter.art);
  if (filter.nur !== null) p.set("nur", filter.nur);
  const s = p.toString();
  return s === "" ? "/mietenbuch" : `/mietenbuch?${s}`;
}

/** Derselbe Filter ohne ein Feld -- für die entfernbaren Marken. */
export function ohneFeld(
  filter: Mietenbuchfilter,
  feld: keyof Mietenbuchfilter,
): Mietenbuchfilter {
  switch (feld) {
    case "objekt":
      return { ...filter, objekt: null };
    case "suche":
      return { ...filter, suche: "" };
    case "art":
      return { ...filter, art: null };
    case "nur":
      return { ...filter, nur: null };
  }
}

/**
 * Passt diese Zeile zum Filter?
 *
 * `nur=abweichung` nimmt die Grenze von einem Euro, dieselbe wie überall
 * sonst in dieser Anwendung (Mahnwesen, Kennzahlkarten): Centreste aus
 * anteiligen Monaten sind kein Rückstand. `nur=leerstand` fragt nach
 * **echtem** Leerstand (`monate_leer`) und nicht nach leeren Zellen -- ein
 * Zimmer, das über den Vertrag seiner Etage belegt ist, und eine Einheit mit
 * ungepflegter Belegung sind kein Leerstand.
 */
function passtZeile(z: RasterZeile, f: Mietenbuchfilter): boolean {
  if (f.art !== null && z.einheit.art !== f.art) return false;
  if (f.nur === "abweichung" && z.summe.abweichung > -1) return false;
  if (f.nur === "leerstand" && z.summe.monate_leer < 1) return false;

  if (f.suche !== "") {
    const n = klein(f.suche);
    const felder = [
      z.einheit.bezeichnung,
      z.einheit.etage,
      z.einheit.eltern_bezeichnung,
    ];
    const imStamm = felder.some(
      (t): boolean => typeof t === "string" && klein(t).includes(n),
    );
    // Mieternamen stehen je Monat in den Abschnitten. Gesucht wird über den
    // ganzen Zeitraum: Wer nach einem Vormieter sucht, soll die Zeile
    // finden, in der er stand.
    const imNamen =
      imStamm ||
      z.zellen.some((c) =>
        c.abschnitte.some((a) => klein(a.kontakt_name).includes(n)),
      );
    if (!imNamen) return false;
  }

  return true;
}

/**
 * Ein Ausschnitt des Rasters -- mit neu gerechneten Summen.
 *
 * Zeilensummen bleiben, wie sie sind: Sie gehören zur Zeile und ändern sich
 * durch das Ausblenden anderer Zeilen nicht. Neu gerechnet werden die
 * Spaltenfüsse je Monat (`summiere` über die sichtbaren Zellen) und die
 * Objekt- und Gesamtsummen (`addiereSummen` über die sichtbaren Zeilen).
 *
 * Trifft der Filter nichts, kommt ein leeres Raster zurück: keine Gruppen,
 * je Monat eine Nullspalte und eine Gesamtsumme von 0. Nicht das
 * ungefilterte Raster -- "kein Treffer" und "alles" dürfen nie dasselbe
 * Bild ergeben.
 */
export function filterRaster(
  raster: Raster,
  filter: Mietenbuchfilter,
): Raster {
  if (!filterGesetzt(filter)) return raster;

  const gruppen: Gruppe[] = [];
  for (const g of raster.gruppen) {
    if (filter.objekt !== null && g.objekt_id !== filter.objekt) continue;

    const zeilen = g.zeilen.filter((z) => passtZeile(z, filter));
    // Ein Objekt ohne sichtbare Zeile bekommt keine Überschrift. Eine
    // Objektzeile über null Einheiten liest sich wie ein leeres Haus.
    if (zeilen.length === 0) continue;

    // Dieselbe Entscheidung wie in `baueRaster`: Ob eine Zelle in die
    // Leerstandsquote zählt, hängt allein an ihrer Einheit. Die steht an
    // der Zeile, also lässt sich die Zuordnung aus den sichtbaren Zeilen
    // wieder aufbauen -- ohne Datenbank und ohne zweite Regel.
    const vermietbarJeEinheit = new Map(
      zeilen.map((z) => [z.einheit.id, istVermietbar(z.einheit)]),
    );
    const vermietbar = (c: Zelle) =>
      vermietbarJeEinheit.get(c.einheit_id) === true;

    gruppen.push({
      objekt_id: g.objekt_id,
      objekt_name: g.objekt_name,
      zahlungsdaten_ab: g.zahlungsdaten_ab,
      zeilen,
      spalten: raster.monate.map((_, i) =>
        summiere(
          zeilen.map((z) => z.zellen[i]),
          vermietbar,
        ),
      ),
      summe: addiereSummen(zeilen.map((z) => z.summe)),
    });
  }

  return {
    monate: raster.monate,
    gruppen,
    spalten: raster.monate.map((_, i) =>
      addiereSummen(gruppen.map((g) => g.spalten[i])),
    ),
    summe: addiereSummen(gruppen.map((g) => g.summe)),
  };
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------
//
// Fünf Abfragen, unabhängig von der Grösse des Rasters. Das ist der Grund,
// warum oben alles reine Funktionen sind: 37 Einheiten über 24 Monate sind
// 888 Zellen, und je Zelle zu fragen wären 888 Abfragen für eine Seite, die
// der Eigentümer mehrmals täglich aufmacht.

/** Der Zeitraum, den die Seite zeigt. */
export interface Zeitraum {
  monate: string[];
  titel: string;
  /** Für die Umschaltung: welches Kalenderjahr, falls eines gewählt ist. */
  jahr: number | null;
}

export function zeitraumFuer(jahr: number | null, heute = new Date()): Zeitraum {
  if (jahr !== null) {
    return { monate: kalenderjahr(jahr), titel: `Kalenderjahr ${jahr}`, jahr };
  }
  return {
    monate: letzteMonate(heute, 12),
    titel: "letzte zwölf Monate",
    jahr: null,
  };
}

export async function ladeMietenbuch(
  zeitraum: Zeitraum,
  heute = new Date(),
): Promise<Raster> {
  const { query, one } = await import("./db");
  const von = zeitraum.monate[0];
  const bis = monatsEnde(zeitraum.monate[zeitraum.monate.length - 1]);

  const [einheiten, mietverhaeltnisse, anpassungen, sollstellungen, buchungen] =
    await Promise.all([
      query<EinheitZeile>(`
        SELECT e.id,
               e.objekt_id,
               o.name                   AS objekt_name,
               o.zahlungsdaten_ab::text AS zahlungsdaten_ab,
               e.bezeichnung,
               e.schluessel,
               e.etage,
               e.art,
               e.eltern_id,
               eltern.bezeichnung       AS eltern_bezeichnung,
               EXISTS (SELECT 1 FROM einheit kind WHERE kind.eltern_id = e.id)
                                        AS hat_kinder,
               e.vermarktung,
               e.belegung_gepflegt
          FROM einheit e
          JOIN objekt o          ON o.id = e.objekt_id
          LEFT JOIN einheit eltern ON eltern.id = e.eltern_id
      `),

      // Alles, was den Zeitraum irgendwo berührt. Dieselbe Bedingung wie
      // giltImMonat, nur über den ganzen Ausschnitt statt je Monat.
      query<MietverhaeltnisZeile>(
        `SELECT mv.id,
                mv.einheit_id,
                k.anzeigename                  AS kontakt_name,
                mv.beginn::text,
                mv.ende::text,
                mv.kaltmiete::text,
                mv.nebenkosten::text,
                mv.moeblierungszuschlag::text,
                mv.gesamtmiete::text,
                mv.kaution::text
           FROM mietverhaeltnis mv
           JOIN kontakt k ON k.id = mv.kontakt_id
          WHERE mv.beginn <= $2::date
            AND (mv.ende IS NULL OR mv.ende >= $1::date)`,
        [von, bis],
      ),

      // Auch Anpassungen von vor dem Zeitraum: Die jüngste davon ist der
      // Betrag, der im ersten Monat des Ausschnitts gilt.
      query<AnpassungZeile>(
        `SELECT a.mietverhaeltnis_id,
                a.gilt_ab::text,
                a.kaltmiete::text,
                a.nebenkosten::text,
                a.moeblierungszuschlag::text,
                a.gesamtmiete::text
           FROM mietanpassung a
          WHERE a.gilt_ab <= $1::date`,
        [bis],
      ),

      // Gestellte Monatsmieten mit dem, was ihnen zugeordnet ist. Der Join
      // auf buchung ist derselbe wie in lib/mieter.ts -- gezahlt_am ist der
      // Buchungstag, nicht der Tag der Zuordnung.
      query<SollZeile>(
        `SELECT s.mietverhaeltnis_id,
                s.monat::text,
                s.betrag::text,
                z.gezahlt::text,
                z.letzte::text AS gezahlt_am
           FROM sollstellung s
           LEFT JOIN (
                 SELECT zz.sollstellung_id,
                        SUM(zz.betrag)     AS gezahlt,
                        MAX(b.buchungstag) AS letzte
                   FROM zuordnung zz
                   JOIN buchung b ON b.id = zz.buchung_id
                  GROUP BY zz.sollstellung_id
           ) z ON z.sollstellung_id = s.id
          WHERE s.monat BETWEEN $1::date AND $2::date`,
        [von, bis],
      ),

      one<{ vorhanden: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM buchung) AS vorhanden`,
      ),
    ]);

  return baueRaster({
    einheiten,
    mietverhaeltnisse,
    anpassungen,
    sollstellungen,
    buchungen_vorhanden: buchungen?.vorhanden === true,
    monate: zeitraum.monate,
    heute,
  });
}
