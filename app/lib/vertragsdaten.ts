import { one } from "./db";
import { sollGesamt } from "./sollstellung";

/**
 * Vertragsdaten: die Bruecke zwischen der Datenbank und den beiden
 * Dokumenten, die das Altsystem erzeugt hat.
 *
 * Die Dokumente selbst liegen unveraendert in lib/dokumente/ (Layout und
 * Wortlaut sind juristisch geprueft, zuletzt der Vertrag vom 27.08.2026).
 * Sie erwarten die Form, die das Altsystem in api/_daten.js fuehrt --
 * mv.person / mv.einheit / mv.vertrag / mv.miete / mv.kaution. Diese Datei
 * baut genau diese Form aus den Spalten, die db/017_altdaten.sql dafuer
 * angelegt hat, und nichts darueber hinaus.
 *
 * Das Wichtigste hier ist nicht die Abbildung, sondern die Pruefung.
 *
 * Beide Dokumente fuellen fehlende Angaben stillschweigend mit Leerstring
 * oder lassen ganze Saetze weg: _vertrag.js druckt die Geburtsangaben nur,
 * wenn ein Geburtsdatum da ist (Zeile 143), und _wgb.js ueberspringt jedes
 * leere Feld (schreib() kehrt bei falsy Text sofort zurueck). Ein Vertrag
 * ohne Geburtsdatum sieht deshalb aus wie ein fertiger Vertrag. Er geht
 * raus, wird unterschrieben, und die Luecke fehlt erst auf, wenn es darauf
 * ankommt -- im Streit um die Identitaet des Mieters.
 *
 * Darum wird hier vor dem Erzeugen geprueft und im Zweifel nichts erzeugt.
 * Fuer die uebernommenen Altmieter schlaegt die Pruefung zuverlaessig zu:
 * Geburtsdatum, Geburtsort und Voranschrift stehen bei ihnen nur auf
 * Papier. Die Liste ist deshalb als Arbeitsliste gedacht und nennt alle
 * fehlenden Felder auf einmal, nicht nur das erste.
 */

/** Personenangaben, wie der Vertrag sie erwartet (person.* im Altsystem). */
export interface Person {
  /** Name wie im Pass -- kontakt.anzeigename, nicht rufname. */
  vollerName: string | null;
  /** Anschrift bei Vertragsschluss (mietverhaeltnis.anschrift_vorher). */
  anschriftVorher: string | null;
  mobil: string | null;
  /** ISO-Datum, YYYY-MM-DD. */
  geburtsdatum: string | null;
  geburtsort: string | null;
}

/** Einheitangaben (einheit.* im Altsystem). */
export interface EinheitAngaben {
  /**
   * Die Zimmernummer, wie sie im Vertrag steht: "3", "1.5". Nicht der
   * Anzeigename und nicht einheit.schluessel -- der Vertrag setzt sie in
   * "Vermietet wird Zimmer Nummer ..." ein.
   */
  zimmer: string | null;
  /** einheit.bezeichnung, fuer Fehlermeldungen und Dateinamen. */
  bezeichnung: string;
  /** Die Wohnung bzw. WG, zu der das Zimmer gehoert. */
  wohnung: string | null;
  /** Feld "zusatz" der Wohnungsgeberbestaetigung (melde_zusatz). */
  meldeZusatz: string | null;
  moebliert: boolean;
}

/** Vertragsangaben (vertrag.* im Altsystem). Alle Datumsangaben als ISO. */
export interface VertragAngaben {
  beginn: string | null;
  ende: string | null;
  /** Datum oben rechts im Vertrag -- nicht identisch mit beginn. */
  datum: string | null;
  befristet: boolean;
  kuendigungsverzichtMonate: number;
}

/** Mietangaben (miete.* im Altsystem), in Euro. */
export interface MieteAngaben {
  gesamt: number | null;
  kalt: number | null;
  nebenkosten: number | null;
  moeblierung: number | null;
}

/** Kautionsangaben (kaution.* im Altsystem). */
export interface KautionAngaben {
  betrag: number | null;
  raten: number;
}

export interface Vertragsdaten {
  mietverhaeltnisId: string;
  email: string | null;
  status: string;
  person: Person;
  einheit: EinheitAngaben;
  vertrag: VertragAngaben;
  miete: MieteAngaben;
  kaution: KautionAngaben;
}

// ---------------------------------------------------------------------------
// Pruefung
// ---------------------------------------------------------------------------

/**
 * Fehlt dieser Text?
 *
 * Nur-Leerzeichen zaehlt als fehlend und nicht als Inhalt. Sonst genuegt
 * ein versehentliches Leerzeichen im Formular, um die Pruefung zu
 * bestehen -- und gedruckt wird dann derselbe leere Vertrag, den die
 * Pruefung verhindern soll.
 */
function textFehlt(wert: string | null | undefined): boolean {
  return wert === null || wert === undefined || String(wert).trim() === "";
}

/** Fehlt dieser Betrag? NaN zaehlt mit: Number(undefined) darf nicht durchgehen. */
function betragFehlt(wert: number | null | undefined): boolean {
  return wert === null || wert === undefined || !Number.isFinite(wert);
}

/** Fehlt dieser Betrag oder ist er nicht positiv? */
function betragFehltOderNull(wert: number | null | undefined): boolean {
  return betragFehlt(wert) || Number(wert) <= 0;
}

/**
 * Die Felder, ohne die kein Mietvertrag erzeugt werden darf -- in
 * menschenlesbarer Form, als Arbeitsliste.
 *
 * Reine Funktion: keine Datenbank, keine Uhrzeit, keine Seiteneffekte.
 *
 * Nicht in der Liste und mit Absicht nicht:
 *   Mobilnummer   -- _vertrag.js Zeile 135 setzt dafuer ein "-" ein. Das
 *                    ist ein gewollter Platzhalter, kein Loch.
 *   Kuendigungsverzicht -- 0 Monate ist eine gueltige Vereinbarung und
 *                    druckt die gesetzliche Frist (Zeile 165).
 *   Kautionsraten -- 1 ist der Normalfall ("in einer Summe", Zeile 183).
 *   Enddatum      -- nur bei Befristung, siehe unten.
 */
export function fehlendeFelder(d: Vertragsdaten): string[] {
  const fehlt: string[] = [];

  // --- Person ---
  // Der Mieter steht an sechs Stellen im Vertrag, darunter im Satz
  // "zwischen ... und dem Mieter" und ueber der Unterschriftslinie.
  if (textFehlt(d.person.vollerName)) fehlt.push("Voller Name (wie im Pass)");

  // Anschrift bei Vertragsschluss, nicht die heutige: nach dem Einzug ist
  // die heutige die Mietsache selbst (siehe db/017, anschrift_vorher).
  if (textFehlt(d.person.anschriftVorher)) fehlt.push("Anschrift vor Einzug");

  // Die beiden Felder, an denen der Vertrag still verarmt: ohne
  // Geburtsdatum laesst _vertrag.js die ganze Geburtsklausel weg, und
  // ohne sie benennt der Vertrag keine bestimmte Person mehr -- zwei
  // Namensvetter sind in einer WG keine Seltenheit.
  if (textFehlt(d.person.geburtsdatum)) fehlt.push("Geburtsdatum");
  // Der Geburtsort haengt im Dokument am Geburtsdatum und verschwindet
  // mit ihm; einzeln ergaenzt wird er dort nie.
  if (textFehlt(d.person.geburtsort)) fehlt.push("Geburtsort");

  // Steht im Vertragskopf und ist im Altsystem der Schluessel des
  // Mietverhaeltnisses. Ohne sie druckt Zeile 135 "E-Mail: ".
  if (textFehlt(d.email)) fehlt.push("E-Mail-Adresse");

  // --- Einheit ---
  // "Vermietet wird Zimmer Nummer ..." (§ 1), der Verwendungszweck der
  // Ueberweisung und das Widerrufsformular setzen alle die Zimmernummer
  // ein. Fehlt sie, bleibt in § 1 eine Luecke mitten im Satz.
  if (textFehlt(d.einheit.zimmer)) fehlt.push("Zimmernummer");

  // --- Vertrag ---
  // Ohne Mietbeginn wirft mietvertrag() selbst (Zeile 70). Hier steht es
  // trotzdem, damit der Grund in der Liste auftaucht statt als Ausnahme
  // aus dem Dokument.
  if (textFehlt(d.vertrag.beginn)) fehlt.push("Mietbeginn");

  // Das Datum oben rechts, in der Unterschriftszeile und in Anlage 1.
  // _vertrag.js setzt dafuer ersatzweise das heutige Datum ein (Zeile 68).
  // Beim Erstdruck stimmt das; bei jedem Nachdruck im Mieterbereich traegt
  // der Vertrag dann das Datum des Abrufs. Von diesem Datum laeuft die
  // Widerrufsfrist aus Anlage 1 -- es wird hier verlangt und nicht geraten.
  if (textFehlt(d.vertrag.datum)) fehlt.push("Vertragsdatum");

  // Befristet heisst § 549 Abs. 2 Nr. 1 BGB und aendert § 2. Ohne Enddatum
  // druckt die Ueberschrift "befristet bis " ohne Datum. Unbefristet ohne
  // Enddatum ist dagegen der Normalfall und vollstaendig.
  if (d.vertrag.befristet && textFehlt(d.vertrag.ende)) {
    fehlt.push("Enddatum (Vertrag ist als befristet erfasst)");
  }

  // --- Miete ---
  // § 3 nennt den Gesamtbetrag und schluesselt ihn nach § 556g BGB auf.
  // eur() gibt fuer leere Werte Leerstring zurueck: "Die Gesamtmiete
  // betraegt  monatlich."
  if (betragFehltOderNull(d.miete.gesamt)) fehlt.push("Gesamtmiete");
  if (betragFehltOderNull(d.miete.kalt)) fehlt.push("Nettokaltmiete");
  // 0,00 EUR ist hier zulaessig (keine Pauschale vereinbart), leer nicht.
  if (betragFehlt(d.miete.nebenkosten)) fehlt.push("Betriebskostenpauschale");

  // Der Moeblierungszuschlag wird nur verlangt, wenn die Aufschluesselung
  // sonst nicht aufgeht: Zeile 174 druckt ihn nur, wenn er gesetzt ist.
  // Ist die Gesamtmiete hoeher als Kalt plus Nebenkosten, fehlt im
  // gedruckten § 556g-Nachweis genau die Differenz -- und das ist derselbe
  // verlorene Zuschlag, der in der Sollstellung schon einmal unter den
  // Tisch gefallen ist. Nicht an moebliert festgemacht: ein moebliertes
  // Zimmer kann ohne gesonderten Zuschlag vermietet sein, und dann geht
  // die Rechnung auf.
  if (
    !betragFehlt(d.miete.gesamt) &&
    !betragFehlt(d.miete.kalt) &&
    !betragFehlt(d.miete.nebenkosten) &&
    betragFehltOderNull(d.miete.moeblierung) &&
    Number(d.miete.gesamt) - (Number(d.miete.kalt) + Number(d.miete.nebenkosten)) > 0.005
  ) {
    fehlt.push("Möblierungszuschlag (Gesamtmiete liegt über Kalt + Nebenkosten)");
  }

  // --- Kaution ---
  // § 4 druckt den Betrag immer. Leer ergibt "Die Kaution betraegt ."
  if (betragFehlt(d.kaution.betrag)) fehlt.push("Kaution");

  // Zwei Raten kann dieser Vertrag nicht ausdruecken.
  //
  // § 4 verzweigt nur zwischen "in einer Summe" (raten = 1) und dem Text
  // nach § 551 Abs. 2 BGB, und der nennt fest "drei gleichen Monatsraten".
  // Bei raten = 2 druckt der Vertrag also drei, obwohl zwei vereinbart sind
  // -- die Urkunde gibt die Vereinbarung dann falsch wieder, und zwar zum
  // Vorteil des Mieters, der sich auf die dritte Rate berufen kann.
  //
  // Der Wortlaut des Vertrags wird hier NICHT geaendert: Das ist eine
  // geprueft verwendete Vorlage, und § 551 Abs. 2 BGB gibt dem Mieter die
  // drei Raten ohnehin als Anspruch. Geaendert wird auch der CHECK in
  // db/017 nicht, der 1 bis 3 erlaubt -- was in den Daten stehen darf, ist
  // eine kaufmaennische Entscheidung, keine technische.
  //
  // Stattdessen entsteht das Dokument nicht. Ein blockierter Vertrag ist
  // ein Anruf; ein Vertrag, der die Abrede falsch wiedergibt, ist ein
  // Problem, das erst im Streit auffaellt.
  if (Number(d.kaution.raten) === 2) {
    fehlt.push(
      "Kautionsraten: 2 vereinbart, der Vertrag kann nur 1 oder 3 drucken " +
        "(§ 4 nennt bei Ratenzahlung fest drei Raten)",
    );
  }

  return fehlt;
}

/**
 * Die Felder, ohne die keine Wohnungsgeberbestaetigung erzeugt werden darf.
 *
 * Reine Funktion. Bewusst eine eigene Liste und nicht die des Vertrags:
 * § 19 BMG verlangt den Namen der einziehenden Person, das Einzugsdatum
 * und die Angabe der Wohnung -- Geburtsdatum, Geburtsort, Voranschrift,
 * Miete und Kaution kommen im Formular nicht vor. Wuerde hier die
 * Vertragsliste gelten, bekaeme kein uebernommener Altmieter seine
 * Meldebestaetigung, obwohl alle dafuer noetigen Angaben vorliegen -- und
 * die Anmeldung beim Buergerbuero hat eine Zweiwochenfrist.
 */
export function fehlendeFelderWgb(d: Vertragsdaten): string[] {
  const fehlt: string[] = [];

  if (textFehlt(d.person.vollerName)) fehlt.push("Voller Name (wie im Pass)");

  // Feld "einzug" des Formulars; das Altsystem setzt dort den Mietbeginn.
  if (textFehlt(d.vertrag.beginn)) fehlt.push("Einzugsdatum (Mietbeginn)");

  // Feld "zusatz": Stockwerk und Wohnungslage, z. B. "4. OG links
  // (Studio-Apartment)". Das Buergerbuero braucht es, um die Wohnung im
  // Haus zu bestimmen; die Hausnummer allein genuegt bei neun Zimmern
  // nicht. _wgb.js laesst das Feld bei leerem Wert einfach weiss.
  if (textFehlt(d.einheit.meldeZusatz)) fehlt.push("Meldezusatz (Lage der Wohnung im Haus)");

  return fehlt;
}

/**
 * Holt einen Wert, von dem die Pruefung schon gesagt hat, dass er da ist.
 *
 * Wirft, falls nicht. Das waere kein fehlender Eintrag, sondern eine
 * Pruefliste, die nicht mehr zu dem passt, was das Dokument braucht --
 * und die soll auffallen, statt ein leeres Feld zu drucken.
 */
function gesichert(wert: string | null | undefined, feld: string): string {
  if (textFehlt(wert)) {
    throw new Error(
      `${feld} fehlt, obwohl die Prüfung bestanden wurde — die Prüfliste ` +
        "passt nicht mehr zum Dokument.",
    );
  }
  return String(wert);
}

/** Eine Fehlermeldung, die alle fehlenden Felder nennt. */
function meldung(was: string, d: Vertragsdaten, fehlt: string[]): string {
  const wer = textFehlt(d.person.vollerName)
    ? d.einheit.bezeichnung
    : `${d.person.vollerName} (${d.einheit.bezeichnung})`;
  return (
    `${was} für ${wer} nicht erzeugt: ${fehlt.length} ` +
    `${fehlt.length === 1 ? "Angabe fehlt" : "Angaben fehlen"} — ` +
    fehlt.join(", ") +
    ". Bitte am Mietverhältnis nachtragen; ein Dokument mit leeren Feldern " +
    "wird nicht erzeugt."
  );
}

// ---------------------------------------------------------------------------
// Abbildung
// ---------------------------------------------------------------------------

/**
 * Die Zimmernummer aus dem Anzeigenamen der Einheit.
 *
 * "Zimmer 3" -> "3", "Zimmer 1.5" -> "1.5". Alles andere -> null:
 * "Single-Apartment 3. OG" oder "Wohnung 2" sind keine WG-Zimmer, und
 * eine daraus geratene Nummer stuende anschliessend im Vertrag.
 *
 * Nicht aus einheit.schluessel: der ist "w9-1og-z5" und traegt die Etage
 * mit. Nicht aus dem Schluessel zurueckrechnen heisst auch, dass eine
 * Einheit ohne Schluessel (Welserstrasse 10) hier nicht anders behandelt
 * wird als eine mit.
 */
export function zimmernummer(bezeichnung: string | null | undefined): string | null {
  if (textFehlt(bezeichnung)) return null;
  const t = String(bezeichnung).trim();
  const m = /^Zimmer\s+([0-9]+(?:\.[0-9]+)?)$/.exec(t);
  return m ? m[1] : null;
}

/** Macht aus numeric-Text, Zahl, null oder Leerstring eine Zahl oder null. */
export function alsBetrag(wert: string | number | null | undefined): number | null {
  if (wert === null || wert === undefined || String(wert).trim() === "") return null;
  const n = Number(wert);
  return Number.isFinite(n) ? n : null;
}

/** Eine Zeile, wie sie die Abfrage unten liefert. Alles als Text oder null. */
export interface VertragsdatenZeile {
  id: string;
  status: string;
  email: string | null;
  anzeigename: string | null;
  geburtsdatum: string | null;
  geburtsort: string | null;
  anschrift_vorher: string | null;
  mobil: string | null;
  bezeichnung: string;
  wohnung: string | null;
  melde_zusatz: string | null;
  moebliert: boolean;
  beginn: string | null;
  ende: string | null;
  vertrag_datum: string | null;
  befristet: boolean;
  kuendigungsverzicht_monate: number | string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierungszuschlag: string | null;
  gesamtmiete: string | null;
  kaution: string | null;
  kaution_raten: number | string | null;
}

/**
 * Baut aus einer Datenbankzeile die Form, die die Dokumente erwarten.
 *
 * Reine Funktion, damit die Abbildung ohne Datenbank pruefbar ist.
 */
export function ausZeile(z: VertragsdatenZeile): Vertragsdaten {
  const kalt = alsBetrag(z.kaltmiete);
  const nebenkosten = alsBetrag(z.nebenkosten);
  const moeblierung = alsBetrag(z.moeblierungszuschlag);

  // Die Gesamtmiete nicht hier ausrechnen: die Regel steht in
  // lib/sollstellung.ts und gilt fuer Vertrag und Sollstellung gleich.
  // Eine abgeschriebene Kopie hat den Moeblierungszuschlag schon einmal
  // verloren -- im Vertrag waere derselbe Fehler eine falsche Zusage.
  // sollGesamt gibt 0 zurueck, wenn nichts da ist; daraus wird hier
  // wieder null, damit die Pruefung es als fehlend erkennt und nicht
  // "0,00 EUR" in § 3 landet.
  const gesamtRoh = sollGesamt({
    kaltmiete: kalt,
    nebenkosten: nebenkosten,
    moeblierung: moeblierung,
    gesamtmiete: alsBetrag(z.gesamtmiete),
  });

  return {
    mietverhaeltnisId: z.id,
    email: z.email,
    status: z.status,
    person: {
      // anzeigename ist der Passname -- daran haengen die Dokumente.
      // rufname ("Hallo Max") wird hier bewusst nicht gelesen.
      vollerName: z.anzeigename,
      anschriftVorher: z.anschrift_vorher,
      mobil: z.mobil,
      geburtsdatum: z.geburtsdatum,
      geburtsort: z.geburtsort,
    },
    einheit: {
      zimmer: zimmernummer(z.bezeichnung),
      bezeichnung: z.bezeichnung,
      wohnung: z.wohnung,
      meldeZusatz: z.melde_zusatz,
      moebliert: z.moebliert === true,
    },
    vertrag: {
      beginn: z.beginn,
      ende: z.ende,
      datum: z.vertrag_datum,
      befristet: z.befristet === true,
      kuendigungsverzichtMonate: Number(z.kuendigungsverzicht_monate ?? 0) || 0,
    },
    miete: {
      gesamt: gesamtRoh > 0 ? gesamtRoh : null,
      kalt,
      nebenkosten,
      moeblierung,
    },
    kaution: {
      betrag: alsBetrag(z.kaution),
      raten: Number(z.kaution_raten ?? 1) || 1,
    },
  };
}

/**
 * Liest ein Mietverhaeltnis und baut die Form, die die Dokumente erwarten.
 *
 * Die Spalten aus db/017 werden direkt angesprochen und nicht wie in
 * lib/sollstellung.ts defensiv ueber to_jsonb gelesen. Dort war das noetig,
 * weil ein laufender Sollstellungslauf die Migration ueberdauern muss. Hier
 * ist es falsch: ohne 017 kaeme jedes Feld als NULL zurueck, die Pruefung
 * meldete "Geburtsdatum fehlt" -- und Stephan suchte eine Angabe, die
 * laengst erfasst ist. Ein harter Fehler nennt den wahren Grund.
 */
export async function vertragsdaten(
  mietverhaeltnisId: string,
): Promise<Vertragsdaten> {
  const z = await one<VertragsdatenZeile>(
    `
    SELECT mv.id::text,
           mv.status,
           mv.anschrift_vorher,
           mv.melde_zusatz,
           mv.moebliert,
           mv.beginn::text,
           mv.ende::text,
           mv.vertrag_datum::text,
           mv.befristet,
           mv.kuendigungsverzicht_monate,
           mv.kaltmiete::text,
           mv.nebenkosten::text,
           mv.moeblierungszuschlag::text,
           mv.gesamtmiete::text,
           mv.kaution::text,
           mv.kaution_raten,
           -- Passname, nicht Rufname.
           k.anzeigename,
           k.geburtsdatum::text,
           k.geburtsort,
           e.bezeichnung,
           -- Die WG bzw. Wohnung, zu der das Zimmer gehoert -- dieselbe
           -- Ableitung wie die Gruppierung in lib/oeffentlich.ts.
           COALESCE(eltern.bezeichnung, e.bezeichnung) AS wohnung,
           (SELECT ke.email
              FROM kontakt_email ke
             WHERE ke.kontakt_id = k.id
             ORDER BY ke.ist_primaer DESC, ke.email
             LIMIT 1) AS email,
           (SELECT kt.nummer_e164
              FROM kontakt_telefon kt
             WHERE kt.kontakt_id = k.id
             ORDER BY kt.whatsapp_ok DESC, kt.nummer_e164
             LIMIT 1) AS mobil
      FROM mietverhaeltnis mv
      JOIN kontakt k        ON k.id = mv.kontakt_id
      JOIN einheit e        ON e.id = mv.einheit_id
      LEFT JOIN einheit eltern ON eltern.id = e.eltern_id
     WHERE mv.id = $1
  `,
    [mietverhaeltnisId],
  );

  if (!z) {
    throw new Error(
      `Kein Mietverhältnis mit der Kennung ${mietverhaeltnisId} ` +
        "— oder es gehört zu einem anderen Mandanten.",
    );
  }

  return ausZeile(z);
}

// ---------------------------------------------------------------------------
// Dokumente
// ---------------------------------------------------------------------------

export interface Dokument {
  pdf: Uint8Array;
  dateiname: string;
}

/**
 * Der Mietvertrag zu einem Mietverhaeltnis.
 *
 * Wirft, wenn Angaben fehlen -- mit allen fehlenden Feldern in der
 * Meldung, damit sie in einem Durchgang nachgetragen werden koennen.
 *
 * Die Dokumentmodule werden erst hier geladen und nicht oben importiert:
 * lib/dokumente/wgb_vorlage.js ist die Blanko-Vorlage als Base64 und damit
 * rund 160 KB, die nur gebraucht werden, wenn wirklich ein PDF entsteht.
 */
export async function vertragFuer(
  mietverhaeltnisId: string,
): Promise<Dokument> {
  const d = await vertragsdaten(mietverhaeltnisId);
  const fehlt = fehlendeFelder(d);
  if (fehlt.length > 0) throw new Error(meldung("Mietvertrag", d, fehlt));

  const { mietvertrag, vertragDateiname } = await import("./dokumente/vertrag.js");
  const mv = alsAltform(d);
  return { pdf: await mietvertrag(mv), dateiname: vertragDateiname(mv) };
}

/**
 * Die Wohnungsgeberbestaetigung nach § 19 BMG zu einem Mietverhaeltnis.
 *
 * Eigene Pruefliste, siehe fehlendeFelderWgb.
 */
export async function wgbFuer(mietverhaeltnisId: string): Promise<Dokument> {
  const d = await vertragsdaten(mietverhaeltnisId);
  const fehlt = fehlendeFelderWgb(d);
  if (fehlt.length > 0) {
    throw new Error(meldung("Wohnungsgeberbestätigung", d, fehlt));
  }

  const { wohnungsgeberbestaetigung, dateiname } = await import("./dokumente/wgb.js");
  const m = {
    vollerName: gesichert(d.person.vollerName, "Voller Name"),
    einzug: gesichert(d.vertrag.beginn, "Einzugsdatum"),
    zusatz: gesichert(d.einheit.meldeZusatz, "Meldezusatz"),
  };
  return { pdf: await wohnungsgeberbestaetigung(m), dateiname: dateiname(m) };
}

/**
 * Die Form, die lib/dokumente/vertrag.js erwartet (mv.* aus api/_daten.js).
 *
 * Eigene Funktion und nicht Vertragsdaten selbst: Vertragsdaten traegt
 * zusaetzlich Kennung, Status und Bezeichnung, und die Dokumentkopie soll
 * genau die Felder sehen, die sie im Altsystem gesehen hat.
 */
export function alsAltform(d: Vertragsdaten) {
  return {
    email: d.email,
    person: {
      vollerName: d.person.vollerName,
      anschriftVorher: d.person.anschriftVorher,
      mobil: d.person.mobil,
      geburtsdatum: d.person.geburtsdatum,
      geburtsort: d.person.geburtsort,
    },
    einheit: {
      zimmer: d.einheit.zimmer,
      wohnung: d.einheit.wohnung,
      meldeZusatz: d.einheit.meldeZusatz,
      moebliert: d.einheit.moebliert,
    },
    vertrag: {
      beginn: d.vertrag.beginn,
      // Das Enddatum darf nur in den Vertrag, wenn er befristet ist:
      // ende traegt auch einen Kuendigungstermin (db/017), und § 2 wuerde
      // daraus einen Zeitmietvertrag nach § 549 Abs. 2 Nr. 1 BGB machen,
      // den niemand geschlossen hat.
      ende: d.vertrag.befristet ? d.vertrag.ende : null,
      datum: d.vertrag.datum,
      befristet: d.vertrag.befristet,
      kuendigungsverzichtMonate: d.vertrag.kuendigungsverzichtMonate,
    },
    miete: {
      gesamt: d.miete.gesamt,
      kalt: d.miete.kalt,
      nebenkosten: d.miete.nebenkosten,
      moeblierung: d.miete.moeblierung,
    },
    kaution: { betrag: d.kaution.betrag, raten: d.kaution.raten },
  };
}
