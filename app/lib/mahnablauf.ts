import { query, one, tx } from "./db";
import { verlangeFreigabe, freigabe, type Freigabe } from "./mahnfreigabe";
import type { Rueckstand, Stufe } from "./mahnstufen";
import type { Rolle } from "./sitzung";

/**
 * Der Mahnablauf: was von selbst geschieht, was auf eine Entscheidung
 * wartet, und wie diese Entscheidung festgehalten wird.
 *
 * Die Rechnerei steht nicht hier. Welche Stufe ein Mietverhältnis hat,
 * entscheidet allein lib/mahnstufen.ts; diese Datei fragt dort nur nach und
 * gibt die Begründung wörtlich weiter. Hier steht die Stufe darüber: Wer
 * darf etwas anstoßen, was ist gesperrt, und was bedeutet "verschoben".
 *
 * Zwei Hälften, bewusst getrennt:
 *
 *   1. Reine Funktionen (oben). Keine Datenbank, keine Uhr -- jede
 *      Verzweigung lässt sich in tests/mahnablauf.test.ts nachstellen.
 *      Alles, was darüber entscheidet, ob jemand ein Schreiben bekommt,
 *      gehört hierhin.
 *   2. Die Schreibfunktionen (unten). Sie legen Entwürfe und Vorgänge an,
 *      und sie versenden nichts. Es gibt in dieser Datei keinen Aufruf,
 *      der eine Mail abschickt; der Versand bleibt der Freigabe-
 *      Warteschlange überlassen, und auch dort drückt ein Mensch.
 */

// ---------------------------------------------------------------------------
// Reine Funktionen
// ---------------------------------------------------------------------------

/** Welche Stufen überhaupt ein Schreiben rechtfertigen. */
export const SCHREIBENDE_STUFEN: Stufe[] = ["erinnerung", "mahnung"];

export type EntscheidungArt =
  | "verschoben"
  | "ausgesetzt"
  | "entworfen"
  | "wieder_vorgelegt";

/**
 * Eine Entscheidung zu einem Rückstand, so wie sie im Protokoll steht.
 *
 * Es gibt keine Tabelle dafür und es braucht auch keine: Jede Entscheidung
 * ist ein Eintrag in `protokoll` (db/001: ereignis + details jsonb) an einem
 * Vorgang der Kategorie "mahnwesen". Damit liegt sie dort, wo in dieser
 * Anwendung ohnehin jede Spur liegt, und ist auf der Vorgangsseite lesbar,
 * ohne dass dafür etwas gebaut werden musste.
 */
export interface Entscheidung {
  mietverhaeltnis_id: string;
  art: EntscheidungArt;
  /** Nur bei "verschoben": Tag der Wiedervorlage, ISO. */
  bis: string | null;
  grund: string;
  wer: string;
  /** ISO-Zeitstempel des Protokolleintrags. */
  zeitpunkt: string;
  vorgang_id: string | null;
  vorgang_nummer: number | null;
}

/** Tagesdatum als ISO-String -- Vergleiche laufen über Zeichenketten. */
export function alsTag(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Heute plus n Tage, als Tagesdatum. */
export function plusTage(heute: Date, tage: number): string {
  const d = new Date(heute.getTime());
  d.setUTCDate(d.getUTCDate() + tage);
  return alsTag(d);
}

/**
 * Die jeweils jüngste Entscheidung je Mietverhältnis.
 *
 * Das Protokoll wird nur angefügt, nie überschrieben -- eine Verschiebung
 * zurückzunehmen heißt deshalb nicht, den alten Eintrag zu löschen, sondern
 * einen neuen zu schreiben ("wieder_vorgelegt"). So bleibt die Reihenfolge
 * der Entscheidungen lesbar, und wer hinterher fragt, warum drei Wochen
 * nichts passiert ist, findet die Antwort.
 */
export function letzteEntscheidungen(
  liste: Entscheidung[],
): Map<string, Entscheidung> {
  const m = new Map<string, Entscheidung>();
  for (const e of [...liste].sort((a, b) =>
    a.zeitpunkt < b.zeitpunkt ? -1 : a.zeitpunkt > b.zeitpunkt ? 1 : 0,
  )) {
    m.set(e.mietverhaeltnis_id, e);
  }
  return m;
}

/**
 * Ist dieser Fall zurückgestellt, also heute bewusst nicht vorzuschlagen?
 *
 * "ausgesetzt" (nicht mahnen) gilt ohne Enddatum: Der Fall kommt erst
 * wieder, wenn jemand ihn ausdrücklich wieder vorlegt. "verschoben" gilt
 * bis zum gesetzten Tag -- an diesem Tag selbst ist er wieder fällig,
 * sonst wäre eine Verschiebung auf morgen wirkungslos.
 */
export function istZurueckgestellt(
  e: Entscheidung | undefined,
  heute: Date,
): boolean {
  if (!e) return false;
  if (e.art === "ausgesetzt") return true;
  if (e.art === "verschoben") {
    if (!e.bis) return true;
    return e.bis > alsTag(heute);
  }
  return false;
}

export interface Aufteilung {
  /** Was heute auf eine Entscheidung wartet. */
  vorschlaege: Rueckstand[];
  /** Was zurückgestellt ist, mit der Entscheidung dazu. */
  zurueckgestellt: { rueckstand: Rueckstand; entscheidung: Entscheidung }[];
  /** Was sichtbar bleibt, aber ohnehin kein Schreiben auslöst. */
  nurBeobachten: Rueckstand[];
}

/**
 * Teilt den Mahnstand in das auf, was heute zu entscheiden ist, und das,
 * was nicht.
 *
 * Diese Funktion ist der Grund, dass "verschieben" wirkt und nicht nur
 * angezeigt wird: Alles, was vorschlägt -- die Seite, der Lagebericht, ein
 * künftiger nächtlicher Lauf -- soll den Stand hierdurch schicken, nicht
 * ungefiltert aus lib/rueckstaende.ts nehmen.
 */
export function teileAuf(
  stand: Rueckstand[],
  entscheidungen: Map<string, Entscheidung>,
  heute: Date,
): Aufteilung {
  const vorschlaege: Rueckstand[] = [];
  const zurueck: Aufteilung["zurueckgestellt"] = [];
  const beobachten: Rueckstand[] = [];

  for (const r of stand) {
    const e = entscheidungen.get(r.mietverhaeltnis_id);
    if (!SCHREIBENDE_STUFEN.includes(r.stufe)) {
      beobachten.push(r);
      continue;
    }
    if (istZurueckgestellt(e, heute)) {
      zurueck.push({ rueckstand: r, entscheidung: e! });
      continue;
    }
    vorschlaege.push(r);
  }
  return { vorschlaege, zurueckgestellt: zurueck, nurBeobachten: beobachten };
}

/**
 * Nur die Fälle, die heute vorzuschlagen sind.
 *
 * Gedacht für jede Stelle, die von selbst läuft und etwas vorschlägt --
 * heute ist das der Lagebericht (lib/lagebericht.ts). Wer `mahnstand()`
 * ohne diesen Filter benutzt, schlägt einen verschobenen Fall jede Nacht
 * aufs Neue vor, und genau das macht eine Verschiebung wertlos.
 */
export function ohneZurueckgestellte(
  stand: Rueckstand[],
  entscheidungen: Map<string, Entscheidung>,
  heute: Date,
): Rueckstand[] {
  return teileAuf(stand, entscheidungen, heute).vorschlaege;
}

export interface Erlaubnis {
  erlaubt: boolean;
  /** Im Klartext, warum nicht -- das steht so in der Oberfläche. */
  grund: string;
}

/** Darf diese Rolle im Mahnwesen etwas entscheiden? */
export function darfEntscheiden(rolle: Rolle | null): Erlaubnis {
  if (rolle === null) {
    return { erlaubt: false, grund: "Nicht angemeldet." };
  }
  if (rolle === "mieter") {
    return { erlaubt: false, grund: "Ein Mieterzugang hat hier nichts zu suchen." };
  }
  if (rolle === "lesen") {
    return {
      erlaubt: false,
      grund:
        "Dieser Zugang darf lesen, aber nicht entscheiden. Mahnungen gibt " +
        "nur ein Verwalterzugang frei.",
    };
  }
  return { erlaubt: true, grund: "" };
}

/**
 * Darf zu diesem Rückstand ein Entwurf entstehen?
 *
 * Vier Gründe, warum nicht, und alle vier sind absichtlich:
 *   - das Mahnwesen ist gesperrt (keine Zeile in mahnwesen_freigabe)
 *   - die Rolle darf nicht
 *   - die Stufe trägt kein Schreiben (beobachten, nicht fällig,
 *     fehlende Monatsmiete, Monate ohne Kontodaten)
 *   - der Fall ist verschoben oder ausgesetzt
 */
export function darfEntwerfen(opts: {
  freigegeben: boolean;
  rolle: Rolle | null;
  stufe: Stufe;
  zurueckgestellt: boolean;
}): Erlaubnis {
  const rolle = darfEntscheiden(opts.rolle);
  if (!rolle.erlaubt) return rolle;

  if (!opts.freigegeben) {
    return {
      erlaubt: false,
      grund:
        "Das Mahnwesen ist gesperrt. Es entsteht kein Entwurf, auch keiner, " +
        "der nur in der Freigabe liegt.",
    };
  }
  if (!SCHREIBENDE_STUFEN.includes(opts.stufe)) {
    return {
      erlaubt: false,
      grund:
        "Diese Stufe trägt kein Schreiben. Die Begründung daneben sagt, " +
        "woran es liegt.",
    };
  }
  if (opts.zurueckgestellt) {
    return {
      erlaubt: false,
      grund:
        "Der Fall ist zurückgestellt. Erst wieder vorlegen, dann entwerfen " +
        "-- so bleibt in der Akte, dass die Verschiebung aufgehoben wurde.",
    };
  }
  return { erlaubt: true, grund: "" };
}

export interface Befundartig {
  punkt: string;
  erfuellt: boolean;
}

/** Welche Punkte der Bereitschaftsliste noch offen sind. */
export function offenePunkte(befunde: Befundartig[]): string[] {
  return befunde.filter((b) => !b.erfuellt).map((b) => b.punkt);
}

export interface FreigabeKnopf {
  erlaubt: boolean;
  /** Welche Punkte der Bereitschaftsliste noch offen sind. */
  fehlt: string[];
  grund: string;
}

/**
 * Darf das Mahnwesen jetzt freigegeben werden?
 *
 * Der Knopf bleibt gesperrt, solange ein Punkt der Bereitschaftsliste offen
 * ist. Das ist keine Formsache: Jeder offene Punkt ist ein Weg, auf dem ein
 * pünktlicher Zahler als Säumiger erscheint (lib/mahnfreigabe.ts erklärt
 * jeden einzelnen). Neben dem Knopf steht deshalb nicht "gesperrt", sondern
 * was fehlt.
 */
export function freigabeKnopf(opts: {
  befunde: Befundartig[];
  schonFreigegeben: boolean;
  rolle: Rolle | null;
  notiz: string;
}): FreigabeKnopf {
  const fehlt = offenePunkte(opts.befunde);
  const rolle = darfEntscheiden(opts.rolle);
  if (!rolle.erlaubt) return { erlaubt: false, fehlt, grund: rolle.grund };

  if (opts.schonFreigegeben) {
    return {
      erlaubt: false,
      fehlt,
      grund: "Das Mahnwesen ist bereits freigegeben.",
    };
  }
  if (opts.befunde.length === 0) {
    return {
      erlaubt: false,
      fehlt,
      grund:
        "Die Bereitschaftsliste konnte nicht erhoben werden. Ohne sie wird " +
        "nicht freigegeben.",
    };
  }
  if (fehlt.length > 0) {
    return {
      erlaubt: false,
      fehlt,
      grund: `Noch offen: ${fehlt.join("; ")}.`,
    };
  }
  if (opts.notiz.trim().length < 5) {
    return {
      erlaubt: false,
      fehlt,
      grund:
        "Die Notiz fehlt. Woran die Freigabe hing, gehört zur Entscheidung " +
        "-- zum Beispiel: Abgleich bis 10/2026 geprüft, keine offenen Eingänge.",
    };
  }
  return { erlaubt: true, fehlt, grund: "" };
}

/** Prüft Datum und Grund einer Verschiebung. */
export function pruefeVerschiebung(opts: {
  bis: string;
  grund: string;
  heute: Date;
}): { ok: boolean; fehler?: string; bis?: string; grund?: string } {
  const bis = opts.bis.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    return { ok: false, fehler: "Bitte ein Datum im Format JJJJ-MM-TT." };
  }
  const heute = alsTag(opts.heute);
  if (bis <= heute) {
    return {
      ok: false,
      fehler:
        "Der Tag der Wiedervorlage muss in der Zukunft liegen -- sonst ist " +
        "der Fall sofort wieder offen.",
    };
  }
  // Ein Jahr ist die Grenze. Was länger liegen soll, ist keine Verschiebung,
  // sondern die Entscheidung, nicht zu mahnen -- und die hat einen eigenen
  // Knopf und einen eigenen Grund.
  if (bis > plusTage(opts.heute, 366)) {
    return {
      ok: false,
      fehler:
        "Mehr als ein Jahr ist keine Verschiebung. Dann ist es die " +
        'Entscheidung "nicht mahnen".',
    };
  }
  const g = pruefeGrund(opts.grund);
  if (!g.ok) return { ok: false, fehler: g.fehler };
  return { ok: true, bis, grund: g.grund };
}

/**
 * Der Grund ist Pflicht.
 *
 * Nicht aus Formalismus: Eine Verschiebung ohne Grund ist in sechs Wochen
 * nicht mehr von Vergessen zu unterscheiden. Steht "Ratenzahlung bis
 * Januar zugesagt" dabei, weiß der Nächste, woran er ist.
 */
export function pruefeGrund(
  grund: string,
): { ok: boolean; fehler?: string; grund: string } {
  const g = grund.trim().replace(/\s+/g, " ");
  if (g.length < 5) {
    return {
      ok: false,
      fehler:
        "Bitte einen Grund angeben. In sechs Wochen ist eine Entscheidung " +
        "ohne Grund nicht von Vergessen zu unterscheiden.",
      grund: g,
    };
  }
  return { ok: true, grund: g.slice(0, 500) };
}

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);

const tagDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso + "T12:00:00Z"));

const monatDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(iso + "T12:00:00Z"),
  );

/** Zahlungsziel je Stufe, in Tagen. */
export const ZAHLUNGSZIEL: Record<"erinnerung" | "mahnung", number> = {
  erinnerung: 10,
  mahnung: 7,
};

export interface Schreiben {
  betreff: string;
  koerper: string;
  /** Bis wann gezahlt werden soll. */
  zahlbarBis: string;
}

/**
 * Der Text des Schreibens.
 *
 * Drei Festlegungen stecken darin, und alle drei sind absichtlich:
 *
 *   - Gefordert wird nur `offen`. Beträge aus Monaten ohne Kontodaten
 *     kommen im Text nicht vor. Sie sind nicht unbezahlt, sondern
 *     unbekannt (lib/mahnstufen.ts), und eine Forderung über Unbekanntes
 *     ist eine falsche Beschuldigung.
 *   - Keine Kündigungsdrohung, auch nicht bei zwei Monatsmieten. Dass
 *     § 543 Abs. 2 Nr. 3 BGB erfüllt wäre, steht in der Begründung für
 *     den Verwalter -- in das Schreiben gehört es erst, wenn jemand diese
 *     Entscheidung bewusst trifft und sie selbst formuliert.
 *   - Die Fälligkeit wird benannt: bis zum dritten Werktag des Monats
 *     (§ 556b Abs. 1 BGB), so wie die Stufenberechnung sie ansetzt.
 */
export function mahnschreiben(opts: {
  stufe: "erinnerung" | "mahnung";
  name: string;
  einheit: string;
  offen: number;
  aeltesterMonat: string;
  tageUeberfaellig: number;
  heute: Date;
}): Schreiben {
  const zahlbarBis = plusTage(opts.heute, ZAHLUNGSZIEL[opts.stufe]);
  const titel = opts.stufe === "mahnung" ? "Mahnung" : "Zahlungserinnerung";

  const kopf =
    opts.stufe === "mahnung"
      ? `die Miete für ${opts.einheit} ist seit ${opts.tageUeberfaellig} Tagen ` +
        `überfällig. Offen sind ${eur(opts.offen)}, der älteste offene Monat ` +
        `ist ${monatDe(opts.aeltesterMonat)}.`
      : `auf dem Mietkonto für ${opts.einheit} sind ${eur(opts.offen)} offen, ` +
        `ältester offener Monat ist ${monatDe(opts.aeltesterMonat)}. ` +
        "Vermutlich ist die Zahlung untergegangen.";

  const koerper = [
    `Guten Tag ${opts.name},`,
    "",
    kopf,
    "",
    "Die Miete ist nach dem Mietvertrag bis zum dritten Werktag des Monats " +
      "zu zahlen (§ 556b Abs. 1 BGB).",
    "",
    `Wir bitten um Zahlung bis zum ${tagDe(zahlbarBis)}.`,
    "",
    "Sollte die Zahlung inzwischen erfolgt sein, hat sich dieses Schreiben " +
      "damit erledigt -- Zahlungen, die uns nach dem heutigen Tag erreichen, " +
      "sind hier noch nicht berücksichtigt. Wenn die Zahlung gerade nicht " +
      "möglich ist, melden Sie sich bitte; eine Ratenzahlung lässt sich " +
      "besprechen.",
    "",
    "Mit freundlichen Grüßen",
  ].join("\n");

  return {
    betreff: `${titel} -- Miete ${opts.einheit}`,
    koerper,
    zahlbarBis,
  };
}

/**
 * Die Notiz, die am Entwurf hängt.
 *
 * Sie trägt die Begründung aus lib/mahnstufen.ts wörtlich weiter. Wer den
 * Entwurf in der Freigabe sieht, soll ohne Umweg lesen können, warum er
 * entstanden ist -- und auch, was danebensteht und nicht gefordert wird.
 */
export function entwurfsNotiz(r: Rueckstand, wer: string): string {
  const teile = [
    `Stufe ${r.stufe}: ${r.begruendung}`,
    `Gefordert werden ${eur(r.offen)} (${r.einheit}).`,
  ];
  if (r.offen_ohne_daten >= 1) {
    teile.push(
      `Nicht Teil der Forderung: ${eur(r.offen_ohne_daten)} aus ` +
        `${r.monate_ohne_daten.length} Monaten ohne Kontodaten.`,
    );
  }
  teile.push(`Entwurf angestoßen von ${wer}. Versendet wird erst nach Freigabe.`);
  return teile.join(" ");
}

// ---------------------------------------------------------------------------
// Datenbank: Entscheidungen lesen
// ---------------------------------------------------------------------------

/** Welche Protokollereignisse eine Entscheidung im Mahnablauf sind. */
const EREIGNIS: Record<EntscheidungArt, string> = {
  verschoben: "mahnung_verschoben",
  ausgesetzt: "mahnung_ausgesetzt",
  entworfen: "mahnung_entworfen",
  wieder_vorgelegt: "mahnung_wieder_vorgelegt",
};

const ART_ZU_EREIGNIS = new Map<string, EntscheidungArt>(
  Object.entries(EREIGNIS).map(([art, e]) => [e, art as EntscheidungArt]),
);

interface ProtokollZeile {
  ereignis: string;
  zeitpunkt: string;
  vorgang_id: string | null;
  vorgang_nummer: number | null;
  mietverhaeltnis_id: string | null;
  bis: string | null;
  grund: string | null;
  wer: string | null;
}

/**
 * Alle Entscheidungen aus dem Protokoll, jüngste zuletzt.
 *
 * Gelesen wird über `details ->> 'mietverhaeltnis_id'`. Das ist der Grund,
 * warum es für diesen Teil keine neue Spalte und keine neue Tabelle
 * braucht: Die Zuordnung steckt im jsonb, das Ereignis im Namen, und der
 * Vorgang hängt mit dran.
 */
export async function entscheidungen(): Promise<Entscheidung[]> {
  const zeilen = await query<ProtokollZeile>(
    `SELECT p.ereignis,
            p.zeitpunkt::text                     AS zeitpunkt,
            p.vorgang_id,
            v.nummer                              AS vorgang_nummer,
            p.details ->> 'mietverhaeltnis_id'    AS mietverhaeltnis_id,
            p.details ->> 'bis'                   AS bis,
            p.details ->> 'grund'                 AS grund,
            p.details ->> 'wer'                   AS wer
       FROM protokoll p
       LEFT JOIN vorgang v ON v.id = p.vorgang_id
      WHERE p.ereignis = ANY($1::text[])
        AND p.details ->> 'mietverhaeltnis_id' IS NOT NULL
      ORDER BY p.zeitpunkt ASC`,
    [Object.values(EREIGNIS)],
  );

  return zeilen.map((z) => ({
    mietverhaeltnis_id: z.mietverhaeltnis_id!,
    art: ART_ZU_EREIGNIS.get(z.ereignis) ?? "wieder_vorgelegt",
    bis: z.bis,
    grund: z.grund ?? "",
    wer: z.wer ?? "unbekannt",
    zeitpunkt: z.zeitpunkt,
    vorgang_id: z.vorgang_id,
    vorgang_nummer: z.vorgang_nummer === null ? null : Number(z.vorgang_nummer),
  }));
}

/**
 * Die zurückgestellten Mietverhältnisse -- für alles, was von selbst läuft.
 *
 * Eine Zeile Code für jede Stelle, die vorschlägt: erst hier fragen, dann
 * vorschlagen.
 */
export async function zurueckgestellteIds(heute = new Date()): Promise<Set<string>> {
  const letzte = letzteEntscheidungen(await entscheidungen());
  const ids = new Set<string>();
  for (const [id, e] of letzte) if (istZurueckgestellt(e, heute)) ids.add(id);
  return ids;
}

/** Die letzten Entscheidungen im Wortlaut -- für die Nachschau auf der Seite. */
export async function entscheidungsVerlauf(grenze = 25): Promise<Entscheidung[]> {
  const alle = await entscheidungen();
  return alle.slice(-grenze).reverse();
}

// ---------------------------------------------------------------------------
// Datenbank: Freigabe schalten
// ---------------------------------------------------------------------------

/**
 * Erteilt die Freigabe des Mahnwesens.
 *
 * Bis hierhin ging das nur mit einem INSERT von Hand. Das war kein
 * Schutzmechanismus, sondern eine unbediente Schaltstelle: Wer die
 * Bereitschaftsliste vor sich hat, soll dort entscheiden können, und zwar
 * mit derselben Prüfung, die die Oberfläche anzeigt -- deshalb wird `bereit`
 * hier noch einmal übergeben und nicht geglaubt, was der Browser schickt.
 */
export async function erteileFreigabe(opts: {
  wer: string;
  notiz: string;
  bereit: boolean;
  fehlt: string[];
}): Promise<Freigabe> {
  if (!opts.bereit) {
    throw new Error(
      "Die Bereitschaftsliste ist nicht vollständig. Noch offen: " +
        (opts.fehlt.join("; ") || "unbekannt") +
        ".",
    );
  }
  const g = pruefeGrund(opts.notiz);
  if (!g.ok) throw new Error(g.fehler);

  const schon = await freigabe();
  if (schon) return schon;

  return tx(async (c) => {
    // Ohne mandant_id: Die Spalte hat DEFAULT aktueller_mandant() (db/024),
    // und der Mandant der Transaktion kommt aus der Sitzung. Ihn hier von
    // Hand zu setzen wäre die einzige Stelle, an der sich ein falscher
    // Mandant einschleichen könnte.
    const r = await c.query<Freigabe>(
      `INSERT INTO mahnwesen_freigabe (freigegeben_von, notiz)
       VALUES ($1, $2)
       RETURNING freigegeben_am::text, freigegeben_von, notiz`,
      [opts.wer, g.grund],
    );
    // Ohne Vorgang: Die Freigabe gehört zu keinem Mietverhältnis. protokoll
    // erlaubt vorgang_id NULL (db/001), und damit ist auch diese
    // Entscheidung später lesbar -- einschließlich der Rücknahme, die in
    // der Tabelle selbst keine Spur hinterlässt (dort gibt es kein UPDATE,
    // nur INSERT und DELETE).
    await c.query(
      `INSERT INTO protokoll (ereignis, details)
       VALUES ('mahnwesen_freigegeben', $1::jsonb)`,
      [JSON.stringify({ wer: opts.wer, notiz: g.grund })],
    );
    return r.rows[0];
  });
}

/** Nimmt die Freigabe zurück -- das Mahnwesen ist danach wieder gesperrt. */
export async function nimmFreigabeZurueck(opts: {
  wer: string;
  grund: string;
}): Promise<void> {
  const g = pruefeGrund(opts.grund);
  if (!g.ok) throw new Error(g.fehler);

  await tx(async (c) => {
    await c.query(`DELETE FROM mahnwesen_freigabe`);
    await c.query(
      `INSERT INTO protokoll (ereignis, details)
       VALUES ('mahnwesen_gesperrt', $1::jsonb)`,
      [JSON.stringify({ wer: opts.wer, grund: g.grund })],
    );
  });
}

// ---------------------------------------------------------------------------
// Datenbank: Entscheidungen schreiben
// ---------------------------------------------------------------------------

const ABSENDER = process.env.ABSENDER_EMAIL ?? "verwaltung@stig-immobilien.de";
const ABSENDER_NAME = process.env.ABSENDER_NAME ?? "STIG Immobilien";

interface Vertrag {
  id: string;
  einheit_id: string;
  kontakt_id: string;
  objekt_id: string;
  kontakt_name: string;
  einheit: string;
  email: string | null;
}

/** Die Stammdaten zum Mietverhältnis, die ein Vorgang braucht. */
async function vertrag(mietverhaeltnisId: string): Promise<Vertrag | null> {
  return one<Vertrag>(
    `SELECT mv.id, mv.einheit_id, mv.kontakt_id, e.objekt_id,
            k.anzeigename                         AS kontakt_name,
            COALESCE(e.schluessel, e.bezeichnung) AS einheit,
            (SELECT ke.email FROM kontakt_email ke
              WHERE ke.kontakt_id = k.id
              ORDER BY ke.ist_primaer DESC, ke.email
              LIMIT 1)                            AS email
       FROM mietverhaeltnis mv
       JOIN einheit e ON e.id = mv.einheit_id
       JOIN kontakt k ON k.id = mv.kontakt_id
      WHERE mv.id = $1`,
    [mietverhaeltnisId],
  );
}

/**
 * Der Vorgang, unter dem die Entscheidungen zu diesem Rückstand liegen.
 *
 * Erst wird nach einem offenen Mahnvorgang gesucht -- erkannt an den
 * eigenen Protokolleinträgen, nicht an einer neuen Spalte. Gibt es keinen,
 * entsteht einer. "heikel" ist gesetzt, weil die Kategorie "mahnwesen" in
 * lib/typen.ts zu den heiklen zählt: Hier schreibt kein Agent von selbst
 * einen Entwurf vor.
 */
async function vorgangFuer(
  v: Vertrag,
  status: "offen" | "wartet" | "erledigt",
  frist: string | null,
): Promise<{ id: string; nummer: number }> {
  const vorhanden = await one<{ id: string; nummer: number }>(
    `SELECT v.id, v.nummer
       FROM vorgang v
       JOIN protokoll p ON p.vorgang_id = v.id
      WHERE v.kategorie = 'mahnwesen'
        AND v.status <> 'erledigt'
        AND p.details ->> 'mietverhaeltnis_id' = $1
      ORDER BY p.zeitpunkt DESC
      LIMIT 1`,
    [v.id],
  );

  if (vorhanden) {
    await query(
      `UPDATE vorgang
          SET status = $2, frist = $3::date, geaendert_am = now()
        WHERE id = $1`,
      [vorhanden.id, status, frist],
    );
    return { id: vorhanden.id, nummer: Number(vorhanden.nummer) };
  }

  const neu = await one<{ id: string; nummer: number }>(
    `INSERT INTO vorgang
       (betreff, kategorie, status, heikel, objekt_id, einheit_id, kontakt_id,
        frist)
     VALUES ($1, 'mahnwesen', $2, true, $3, $4, $5, $6::date)
     RETURNING id, nummer`,
    [
      `Mietrückstand ${v.einheit}`,
      status,
      v.objekt_id,
      v.einheit_id,
      v.kontakt_id,
      frist,
    ],
  );
  return { id: neu!.id, nummer: Number(neu!.nummer) };
}

/** Schreibt eine Entscheidung ins Protokoll. */
async function vermerke(opts: {
  vorgangId: string;
  nachrichtId?: string | null;
  art: EntscheidungArt;
  mietverhaeltnisId: string;
  wer: string;
  grund: string;
  bis?: string | null;
  rueckstand: Rueckstand;
}): Promise<void> {
  await query(
    `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      opts.vorgangId,
      opts.nachrichtId ?? null,
      EREIGNIS[opts.art],
      JSON.stringify({
        mietverhaeltnis_id: opts.mietverhaeltnisId,
        wer: opts.wer,
        grund: opts.grund,
        bis: opts.bis ?? null,
        // Der Stand zum Zeitpunkt der Entscheidung. Später lässt sich sonst
        // nicht mehr sagen, worüber entschieden wurde: Die Rückstände
        // ändern sich mit jedem Kontoabruf.
        stufe: opts.rueckstand.stufe,
        offen: opts.rueckstand.offen,
        aeltester_monat: opts.rueckstand.aeltester_monat,
        tage_ueberfaellig: opts.rueckstand.tage_ueberfaellig,
        begruendung: opts.rueckstand.begruendung,
      }),
    ],
  );
}

export interface EntwurfErgebnis {
  vorgang_id: string;
  vorgang_nummer: number;
  nachricht_id: string;
  /** Leer, wenn für den Kontakt keine Adresse hinterlegt ist. */
  empfaenger: string[];
  zahlbarBis: string;
}

/**
 * Legt den Entwurf eines Mahnschreibens an. Versendet nichts.
 *
 * Der Entwurf landet als Nachricht mit status "entwurf" am Vorgang und
 * erscheint damit in der Freigabe-Warteschlange, zusammen mit allen anderen
 * Entwürfen. Von dort geht er erst raus, wenn ein Mensch ihn gelesen und
 * gesendet hat -- diese Datei hat keinen Weg, eine Mail abzuschicken.
 *
 * verlangeFreigabe() steht als Erstes: Ohne Freigabe entsteht nicht einmal
 * ein Entwurf. Das ist strenger als nötig und mit Absicht so -- ein Entwurf
 * in der Warteschlange ist ein Schreiben, das nur noch einen Klick von der
 * Post entfernt ist.
 */
export async function entwerfeMahnung(opts: {
  rueckstand: Rueckstand;
  wer: string;
  heute?: Date;
}): Promise<EntwurfErgebnis> {
  await verlangeFreigabe();

  const heute = opts.heute ?? new Date();
  const r = opts.rueckstand;
  if (r.stufe !== "mahnung" && r.stufe !== "erinnerung") {
    throw new Error(
      "Diese Stufe trägt kein Schreiben: " + r.begruendung,
    );
  }

  const v = await vertrag(r.mietverhaeltnis_id);
  if (!v) throw new Error("Mietverhältnis nicht gefunden.");

  const schreiben = mahnschreiben({
    stufe: r.stufe,
    name: v.kontakt_name,
    einheit: v.einheit,
    offen: r.offen,
    aeltesterMonat: r.aeltester_monat,
    tageUeberfaellig: r.tage_ueberfaellig,
    heute,
  });

  // Der Vorgang bleibt offen: Es ist etwas zu tun, nämlich den Entwurf
  // freizugeben. Die Frist ist das Zahlungsziel.
  const vg = await vorgangFuer(v, "offen", schreiben.zahlbarBis);

  const empfaenger = v.email ? [v.email] : [];
  const notiz =
    entwurfsNotiz(r, opts.wer) +
    (empfaenger.length === 0
      ? " Für diesen Kontakt ist keine E-Mail-Adresse hinterlegt -- der Text " +
        "ist hier zum Übernehmen in ein Schreiben auf Papier."
      : "");

  const n = await one<{ id: string }>(
    `INSERT INTO nachricht
       (vorgang_id, richtung, status, von_email, von_name, an_emails,
        betreff, koerper_text, verfasst_von, agent_notiz)
     VALUES ($1, 'aus', 'entwurf', $2, $3, $4, $5, $6, 'mensch', $7)
     RETURNING id`,
    [
      vg.id,
      ABSENDER,
      ABSENDER_NAME,
      empfaenger,
      schreiben.betreff,
      schreiben.koerper,
      notiz,
    ],
  );

  await vermerke({
    vorgangId: vg.id,
    nachrichtId: n!.id,
    art: "entworfen",
    mietverhaeltnisId: r.mietverhaeltnis_id,
    wer: opts.wer,
    grund: `${r.stufe} entworfen, zahlbar bis ${schreiben.zahlbarBis}`,
    rueckstand: r,
  });

  return {
    vorgang_id: vg.id,
    vorgang_nummer: vg.nummer,
    nachricht_id: n!.id,
    empfaenger,
    zahlbarBis: schreiben.zahlbarBis,
  };
}

/** Verschiebt einen Rückstand auf einen Tag der Wiedervorlage. */
export async function verschiebe(opts: {
  rueckstand: Rueckstand;
  bis: string;
  grund: string;
  wer: string;
}): Promise<{ vorgang_id: string; vorgang_nummer: number; bis: string }> {
  const v = await vertrag(opts.rueckstand.mietverhaeltnis_id);
  if (!v) throw new Error("Mietverhältnis nicht gefunden.");

  // "wartet" und nicht "offen": Der Vorgang steht auf Wiedervorlage und
  // soll bis dahin nicht in der Liste der unbeantworteten Vorgänge liegen.
  const vg = await vorgangFuer(v, "wartet", opts.bis);
  await vermerke({
    vorgangId: vg.id,
    art: "verschoben",
    mietverhaeltnisId: opts.rueckstand.mietverhaeltnis_id,
    wer: opts.wer,
    grund: opts.grund,
    bis: opts.bis,
    rueckstand: opts.rueckstand,
  });
  return { vorgang_id: vg.id, vorgang_nummer: vg.nummer, bis: opts.bis };
}

/** Hält fest, dass hier nicht gemahnt wird. */
export async function setzeAus(opts: {
  rueckstand: Rueckstand;
  grund: string;
  wer: string;
}): Promise<{ vorgang_id: string; vorgang_nummer: number }> {
  const v = await vertrag(opts.rueckstand.mietverhaeltnis_id);
  if (!v) throw new Error("Mietverhältnis nicht gefunden.");

  // "erledigt": Zu diesem Rückstand ist entschieden. Kommt er später
  // wieder auf, entsteht ein neuer Vorgang -- und der alte bleibt mit
  // seinem Grund lesbar.
  const vg = await vorgangFuer(v, "erledigt", null);
  await vermerke({
    vorgangId: vg.id,
    art: "ausgesetzt",
    mietverhaeltnisId: opts.rueckstand.mietverhaeltnis_id,
    wer: opts.wer,
    grund: opts.grund,
    rueckstand: opts.rueckstand,
  });
  return { vorgang_id: vg.id, vorgang_nummer: vg.nummer };
}

/** Hebt eine Verschiebung oder Aussetzung wieder auf. */
export async function legeWiederVor(opts: {
  rueckstand: Rueckstand;
  grund: string;
  wer: string;
}): Promise<{ vorgang_id: string; vorgang_nummer: number }> {
  const v = await vertrag(opts.rueckstand.mietverhaeltnis_id);
  if (!v) throw new Error("Mietverhältnis nicht gefunden.");

  const vg = await vorgangFuer(v, "offen", null);
  await vermerke({
    vorgangId: vg.id,
    art: "wieder_vorgelegt",
    mietverhaeltnisId: opts.rueckstand.mietverhaeltnis_id,
    wer: opts.wer,
    grund: opts.grund,
    rueckstand: opts.rueckstand,
  });
  return { vorgang_id: vg.id, vorgang_nummer: vg.nummer };
}
