import { createHash } from "node:crypto";
import type { RohBuchung } from "../kontoimport";

/**
 * Umsatzabruf über FinTS.
 *
 * Der ganze Sinn dieser Datei steckt in einer Zeile: Es wird **immer** ein
 * Startdatum mitgegeben, und zwar der letzte erfolgreiche Abruf.
 *
 * Fragt man "alles Verfügbare" ab oder einen Zeitraum von mehr als 90
 * Tagen, verlangt jede Bank eine TAN -- bei jedem Lauf, jede Nacht. Dann
 * ist die Anbindung kein Automatismus, sondern eine tägliche Arbeit, und
 * genau die sollte sie abschaffen. Nur wer sich den letzten Abruf merkt
 * und ab dort weiterfragt, kommt mit einer TAN alle 90 Tage aus.
 */

/** Wie viele Tage über den letzten Abruf hinaus zurückgefragt wird. */
const UEBERLAPPUNG_TAGE = 5;

/**
 * Obergrenze für den abgefragten Zeitraum.
 *
 * 85 statt 90: Der Abstand ist Absicht. Die Banken rechnen die Grenze nicht
 * alle gleich (manche ab Buchungstag, manche ab Valuta), und ein Lauf, der
 * genau auf der Kante liegt, löst mal eine TAN aus und mal nicht. Ein
 * Automatismus, der an fünf Tagen Rechenweise hängt, ist keiner.
 */
const MAX_TAGE = 85;

export interface ZugangsDaten {
  id: string;
  bezeichnung: string;
  bank_id: string;
  url: string;
  benutzer: string;
  kunden_id: string | null;
  konto_iban: string | null;
  tan_verfahren: number | null;
  tan_medium: string | null;
  bank_information: unknown | null;
  letzter_abruf: string | null;
}

export type AbrufErgebnis =
  | {
      art: "ok";
      buchungen: RohBuchung[];
      von: string;
      bis: string;
      /** Neue Bankinformationen, falls die Bank sie aktualisiert hat. */
      bank_information: unknown | null;
      /**
       * Der gewuenschte Zeitraum war laenger als ohne TAN moeglich und
       * wurde gekuerzt. Dann fehlt ein Stueck Historie, und das muss ueber
       * einen Dateiexport nachgeholt werden -- sonst sehen die Zahlungen
       * aus der Luecke aus wie Rueckstaende.
       */
      gekuerzt: boolean;
    }
  | {
      art: "tan_faellig";
      /** Was die Bank anzeigt -- geht wörtlich an Stephan. */
      hinweis: string;
      medium: string | null;
    }
  | { art: "fehler"; meldung: string };

/**
 * Macht aus einem Date den ISO-Tag in **lokaler** Zeit.
 *
 * Nicht toISOString(): Der MT940-Parser baut seine Daten mit
 * `new Date(jahr, monat-1, tag)`, also in der Zeitzone des Rechners.
 * toISOString() rechnet nach UTC um und verschiebt damit westlich von
 * Greenwich jeden Buchungstag um einen Tag nach hinten. Ein um einen Tag
 * verschobener Buchungstag ordnet eine Miete dem falschen Monat zu -- und
 * am Monatsersten dem falschen Jahr.
 */
function alsTag(d: Date): string {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const t = String(d.getDate()).padStart(2, "0");
  return `${j}-${m}-${t}`;
}

function tageFrueher(d: Date, tage: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - tage);
  return x;
}

/**
 * Von wann bis wann geholt wird.
 *
 * Die Überlappung von fünf Tagen ist kein Schlendrian: Banken ändern
 * Buchungen noch nachträglich (Storno, korrigierter Verwendungszweck), und
 * eine Buchung, die am Tag des Abrufs noch vorgemerkt war, erscheint erst
 * danach als gebucht. Ohne Überlappung fehlt sie dauerhaft. Doppelte
 * werden über den Fingerabdruck abgefangen, fehlende nicht.
 */
export function zeitraum(
  letzterAbruf: string | null,
  heute: Date,
): { von: Date; bis: Date; gekuerzt: boolean } {
  const bis = heute;
  const frueheste = tageFrueher(heute, MAX_TAGE);

  if (letzterAbruf === null) {
    // Erster Abruf: so weit zurück, wie ohne TAN möglich ist.
    return { von: frueheste, bis, gekuerzt: false };
  }

  const gewuenscht = tageFrueher(
    new Date(letzterAbruf + "T12:00:00"),
    UEBERLAPPUNG_TAGE,
  );
  // War der letzte Abruf lange her, muss gekürzt werden -- sonst TAN.
  // Das wird gemeldet, nicht verschwiegen: Dann fehlt ein Stück Historie,
  // und das muss über einen Dateiexport nachgeholt werden.
  if (gewuenscht < frueheste) {
    return { von: frueheste, bis, gekuerzt: true };
  }
  return { von: gewuenscht, bis, gekuerzt: false };
}

/**
 * Fingerabdruck wie in lib/kontoformate.ts -- mit Mehrfachzähler.
 *
 * Muss dieselbe Form haben: Sonst legt ein FinTS-Abruf Buchungen an, die
 * ein später eingelesener Dateiexport nicht als bekannt erkennt, und jede
 * Zahlung stünde zweimal in der Datenbank.
 */
function nummeriere(
  rohe: Array<Omit<RohBuchung, "fingerabdruck">>,
): RohBuchung[] {
  const gesehen = new Map<string, number>();
  return rohe.map((b) => {
    const schluessel = [
      b.buchungstag,
      b.betrag.toFixed(2),
      b.absender ?? "",
      b.verwendungszweck ?? "",
    ].join("|");
    const lfd = (gesehen.get(schluessel) ?? 0) + 1;
    gesehen.set(schluessel, lfd);
    return {
      ...b,
      fingerabdruck: createHash("sha256")
        .update([schluessel, String(lfd)].join("|"))
        .digest("hex")
        .slice(0, 32),
    };
  });
}

/** Die Felder, die lib-fints je Umsatz liefert, so weit wir sie brauchen. */
export interface FintsUmsatz {
  entryDate: Date;
  valueDate: Date;
  amount: number;
  remoteName?: string;
  purpose?: string;
  bookingText?: string;
}

/**
 * Macht aus den Umsätzen der Bank Rohbuchungen.
 *
 * Reine Funktion, damit sie ohne Bankverbindung prüfbar ist -- und das ist
 * sie wert: Hier entscheidet sich das Vorzeichen, und ein falsches
 * Vorzeichen bucht Abbuchungen als Mieteingänge. Dann erscheint ein
 * Mieter als Zahler, der nichts gezahlt hat.
 *
 * lib-fints liefert den Betrag bereits vorzeichenbehaftet: Der
 * MT940-Parser multipliziert bei 'D' und 'RC' mit -1, der CAMT-Parser bei
 * 'DBIT'. Es wird deshalb NICHT noch einmal umgedreht.
 */
export function alsBuchungen(umsaetze: FintsUmsatz[]): RohBuchung[] {
  const rohe = umsaetze.map((u) => ({
    buchungstag: alsTag(u.entryDate),
    valuta: u.valueDate ? alsTag(u.valueDate) : null,
    betrag: Math.round(u.amount * 100) / 100,
    waehrung: "EUR",
    absender: u.remoteName?.trim() || null,
    verwendungszweck:
      [u.purpose, u.bookingText].filter(Boolean).join(" ").trim() || null,
  }));
  return nummeriere(rohe);
}
