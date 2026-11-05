/**
 * Referenznummern aus einem Beleg lesen -- und im Verwendungszweck
 * wiederfinden.
 *
 * WARUM DAS NOETIG WURDE
 *
 * Der Abgleich suchte die Belegnummer im Verwendungszweck. Bei Amazon
 * steht dort aber die Bestellnummer:
 *
 *     304-2954807-8841912 Amazon.de 3UQ5C3CMI8RC7RAF
 *
 * Die Rechnungsnummer (DE65XW869AEUD) taucht in der Abbuchung nie auf.
 * 162 Abbuchungen und 211 Rechnungen lagen am 05.11.2026 nebeneinander,
 * ohne dass eine einzige Zuordnung zustande kam.
 *
 * WAS HIER NICHT PASSIERT
 *
 * Geraten wird nichts. Jedes Muster steht fuer eine Nummer, die mit
 * einem Schluesselwort im Beleg angekuendigt ist ("Bestellnummer",
 * "Kundennummer", "Kassenzeichen"). Eine beliebige lange Ziffernfolge im
 * Text wird NICHT zur Referenz -- dann waere jede IBAN, jede
 * Artikelnummer und jede Telefonnummer eine, und der Abgleich faende
 * ueberall Treffer. Ein falscher Treffer ist schlimmer als keiner: Er
 * sieht aus wie erledigte Arbeit.
 */

export type ReferenzArt =
  | "bestellnummer"
  | "zahlungsreferenz"
  | "rechnungsnummer"
  | "kundennummer"
  | "vertragsnummer"
  | "kassenzeichen";

export interface Referenz {
  art: ReferenzArt;
  wert: string;
  normiert: string;
}

/**
 * Die Vergleichsform: Grossbuchstaben, ohne Trennzeichen.
 *
 * "304-2954807-8841912" und "3042954807 8841912" sind dieselbe Nummer.
 * Welche Schreibweise im Kontoauszug landet, entscheidet die Bank.
 */
export function normiere(roh: string): string {
  return roh.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Zu kurz, um etwas zu bedeuten.
 *
 * Vier Zeichen stehen zufaellig in jedem zweiten Verwendungszweck. Ab
 * acht wird es eine Nummer, die jemand vergeben hat. Die Grenze ist
 * bewusst hoch: Lieber eine Referenz weniger als ein Treffer, der
 * keiner ist.
 */
const MINDESTLAENGE = 8;

interface Muster {
  art: ReferenzArt;
  regel: RegExp;
}

const MUSTER: Muster[] = [
  // Amazon. Die Bestellnummer ist das verlaesslichste Merkmal: Sie stand
  // am 05.11.2026 in 151 von 151 gelesenen Amazon-Rechnungen und in
  // jeder zugehoerigen Abbuchung.
  { art: "bestellnummer", regel: /Bestellnummer\s*:?\s*(\d{3}-\d{7}-\d{7})/gi },
  // Dieselbe Form auch ohne Schluesselwort: Sie ist eindeutig genug --
  // drei, sieben, sieben Ziffern mit Bindestrichen kommt sonst nicht vor.
  { art: "bestellnummer", regel: /\b(\d{3}-\d{7}-\d{7})\b/g },
  {
    art: "zahlungsreferenz",
    regel: /Zahlungsreferenz(?:nummer)?\s*:?\s*([A-Z0-9]{10,24})\b/g,
  },
  {
    art: "rechnungsnummer",
    regel: /Rechnungs(?:nummer|-?Nr\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/]{5,30})/g,
  },
  {
    art: "kundennummer",
    regel: /(?:Kunden(?:nummer|-?Nr\.?)|Kundenkonto|Vertragskonto)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/]{5,30})/gi,
  },
  {
    art: "vertragsnummer",
    regel: /(?:Vertrags(?:nummer|-?Nr\.?)|Versicherungsschein(?:nummer)?|Police)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/]{5,30})/gi,
  },
  {
    art: "kassenzeichen",
    regel: /Kassenzeichen\s*:?\s*([0-9][0-9.\-/]{5,30})/gi,
  },
];

/**
 * Wörter, die wie eine Nummer aussehen, aber keine sind.
 *
 * Steuernummern und Umsatzsteuer-Identifikationsnummern des AUSSTELLERS
 * stehen auf jeder Rechnung und sind auf jeder Rechnung desselben
 * Ausstellers gleich. Als Referenz genommen, wuerde jede Amazon-Rechnung
 * zu jeder Amazon-Abbuchung passen.
 */
const GESPERRT = /^(DE\d{9}|LU\d{8}|ATU\d{8})$/;

export function findeReferenzen(text: string): Referenz[] {
  const flach = text.replace(/[ \t]+/g, " ");
  const gesehen = new Set<string>();
  const treffer: Referenz[] = [];

  for (const m of MUSTER) {
    // Die Regel traegt /g und damit lastIndex -- eine frische Kopie je
    // Durchlauf, sonst beginnt der zweite Aufruf mitten im Text.
    const regel = new RegExp(m.regel.source, m.regel.flags);
    let g: RegExpExecArray | null;
    while ((g = regel.exec(flach)) !== null) {
      const wert = g[1].trim().replace(/[.,;:]+$/, "");
      const normiert = normiere(wert);
      if (normiert.length < MINDESTLAENGE || normiert.length > 64) continue;
      if (GESPERRT.test(normiert)) continue;
      // Reine Datumsangaben und Betraege, die durchgerutscht sind.
      if (/^\d{8}$/.test(normiert) && /^(19|20)\d{6}$/.test(normiert)) continue;
      const schluessel = `${m.art}:${normiert}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      treffer.push({ art: m.art, wert: wert.slice(0, 64), normiert });
    }
  }
  return treffer;
}

/**
 * Steht diese Referenz im Verwendungszweck?
 *
 * Verglichen wird normiert gegen normiert. Der Verwendungszweck kommt
 * aus dem Kontoauszug und enthaelt Umbrueche, doppelte Leerzeichen und
 * manchmal Bindestriche, die im Beleg nicht stehen.
 */
export function stehtDrin(normierteReferenz: string, text: string): boolean {
  if (normierteReferenz.length < MINDESTLAENGE) return false;
  return normiere(text).includes(normierteReferenz);
}
