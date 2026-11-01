/**
 * Mahnstufen: wer ist wie weit im Rückstand.
 *
 * Reine Logik, keine Datenbank. Das ist Absicht: Diese Funktion entscheidet,
 * ob jemand ein Schreiben bekommt, das ihn beunruhigt. Sie gehört damit zu
 * den wenigen Stellen, die wirklich jede Verzweigung getestet haben müssen,
 * und das geht nur ohne Datenbank.
 *
 * Die Regeln hat Stephan am 01.11.2026 festgelegt:
 *   - Schwelle: eine Monatsmiete Rückstand
 *   - Zahlungserinnerung ab 10 Tagen Verzug
 *   - Mahnung ab 30 Tagen
 *   - keine Ausnahmen, alle Mieter gleich
 *   - versendet wird nie automatisch, alles geht über die Freigabe
 *
 * Fällig ist die Miete bis zum **dritten Werktag** des Monats (§ 556b Abs. 1
 * BGB). Nicht der Monatserste: Wer am Monatsletzten im Voraus überweist,
 * hätte sonst regelmäßig für zwei, drei Tage einen Scheinrückstand -- und
 * das Mahnwesen würde Leute anschreiben, die pünktlich zahlen.
 */

export type Stufe = "ok" | "faellig" | "erinnerung" | "mahnung";

export interface Rueckstand {
  mietverhaeltnis_id: string;
  kontakt_name: string;
  einheit: string;
  /** Summe aller gestellten Beträge, die noch nicht gedeckt sind. */
  offen: number;
  /** Die laufende Monatsmiete -- der Maßstab für die Schwelle. */
  monatsmiete: number;
  /** Ältester offener Monat, auf den ersten des Monats normiert. */
  aeltester_monat: string;
  /** Tage seit Fälligkeit des ältesten offenen Monats. */
  tage_ueberfaellig: number;
  /**
   * Offener Betrag aus Monaten, für die es keine Kontodaten gibt.
   *
   * Zählt absichtlich **nicht** in `offen` hinein: Ohne Kontoauszug ist
   * unbekannt, ob gezahlt wurde, und Unbekanntes ist kein Rückstand.
   */
  offen_ohne_daten: number;
  /** Die Monate dazu, damit man weiß, wo nachzusehen ist. */
  monate_ohne_daten: string[];
  stufe: Stufe;
  /** Warum diese Stufe -- geht wörtlich in die Freigabe. */
  begruendung: string;
}

export interface OffenerPosten {
  mietverhaeltnis_id: string;
  kontakt_name: string;
  einheit: string;
  /** Erster des Monats, ISO. */
  monat: string;
  /** Gestellter Betrag. */
  soll: number;
  /** Bereits zugeordnete Zahlungen für diesen Monat. */
  gezahlt: number;
  /**
   * Liegt dieser Monat vor dem Beginn der Kontodaten des Objekts?
   *
   * Die Abfrage setzt das aus `objekt.zahlungsdaten_ab` (db/023). Fehlt das
   * Datum, ist es für alle Monate `true` -- dann wird für dieses Objekt
   * nicht gemahnt, und das ist die gewollte Richtung.
   */
  ohne_zahlungsdaten?: boolean;
}

/** Feiertage, die bundesweit auf einen Werktag fallen können. */
const FESTE_FEIERTAGE = ["01-01", "05-01", "10-03", "12-25", "12-26"];

/**
 * Ist dieser Tag ein Werktag?
 *
 * Samstag zählt im Mietrecht als Werktag -- aber nicht bei der
 * Mietzahlung: Der BGH hat 2010 entschieden, dass der Sonnabend bei der
 * Schonfrist des § 556b Abs. 1 BGB außer Betracht bleibt, weil Banken an
 * ihm keine Gutschriften buchen (VIII ZR 129/09). Wer am Montag überweist,
 * ist also pünktlich, auch wenn der Samstag davor der "dritte Tag" wäre.
 *
 * Bewegliche Feiertage (Ostern, Himmelfahrt, Pfingsten) sind bewusst nicht
 * berücksichtigt: Sie fallen nie auf die ersten drei Werktage eines Monats
 * in einer Weise, die das Ergebnis ändert, und eine Osterrechnung hier
 * wäre mehr Code als Nutzen. Fronleichnam und Co. sind Ländersache und
 * gelten in Hessen und Rheinland-Pfalz unterschiedlich.
 */
export function istWerktag(d: Date): boolean {
  const tag = d.getUTCDay();
  if (tag === 0 || tag === 6) return false;
  const md = d.toISOString().slice(5, 10);
  return !FESTE_FEIERTAGE.includes(md);
}

/**
 * Der dritte Werktag des Monats -- bis dahin muss die Miete da sein.
 */
export function dritterWerktag(jahr: number, monat1bis12: number): Date {
  const d = new Date(Date.UTC(jahr, monat1bis12 - 1, 1));
  let gezaehlt = 0;
  // Höchstens 14 Tage weit suchen: Mehr als eine Woche Feiertage am Stück
  // gibt es nicht, und eine Endlosschleife wäre hier besonders unschön.
  for (let i = 0; i < 14; i++) {
    if (istWerktag(d)) {
      gezaehlt++;
      if (gezaehlt === 3) return d;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  // Kann nicht eintreten; lieber ein definiertes Ergebnis als undefined.
  return new Date(Date.UTC(jahr, monat1bis12 - 1, 3));
}

/** Tage zwischen zwei Daten, abgerundet. */
function tageZwischen(von: Date, bis: Date): number {
  return Math.floor((bis.getTime() - von.getTime()) / 86_400_000);
}

/**
 * Fasst offene Posten eines Mietverhältnisses zu einer Mahnstufe zusammen.
 *
 * Die Reihenfolge der Prüfungen ist die Logik: Erst wird gefragt, ob
 * überhaupt etwas offen ist, dann ob die Schwelle erreicht ist, dann wie
 * lange es schon dauert. Keine Stufe ohne überschrittene Schwelle --
 * ein fehlender Cent ist kein Mahngrund.
 */
export function stufeFuer(
  posten: OffenerPosten[],
  monatsmiete: number,
  heute: Date,
): Rueckstand | null {
  if (posten.length === 0) return null;

  const alleOffen = posten
    .map((p) => ({ ...p, rest: Math.round((p.soll - p.gezahlt) * 100) / 100 }))
    .filter((p) => p.rest > 0);
  if (alleOffen.length === 0) return null;

  // Monate ohne Kontodaten werden getrennt gehalten, nicht zusammengezählt.
  //
  // Für Ludwigshafen wird ab Januar 2024 abgerechnet, das Konto gibt es aber
  // erst ab Dezember 2024 -- die Mieten davor flossen dem Voreigentümer zu.
  // Diese Monate stehen in der Datenbank als offen, weil ihnen keine Zahlung
  // zugeordnet ist. Sie sind aber nicht unbezahlt, sondern **unbekannt**.
  //
  // Beides zu addieren wäre der schlimmste Fehler, den dieses Modul machen
  // kann: Jeder langjährige Mieter hätte elf Monatsmieten Rückstand und
  // damit einen Kündigungsgrund nach § 543 Abs. 2 Nr. 3 BGB. Die Mahnung
  // ginge genau an die Falschen.
  //
  // Nur die Stufe unterdrücken reicht nicht -- dann wäre für Ludwigshafen
  // dauerhaft gar nichts zu holen, auch ein echter Rückstand von heute
  // nicht. Deshalb trennen: gemahnt wird auf der gedeckten Zeit, der Rest
  // wird ausgewiesen und bleibt eine Aufgabe für einen Menschen.
  const ungedeckt = alleOffen.filter((p) => p.ohne_zahlungsdaten === true);
  const offenJe = alleOffen.filter((p) => p.ohne_zahlungsdaten !== true);

  const summe = (liste: typeof alleOffen) =>
    Math.round(liste.reduce((s, p) => s + p.rest, 0) * 100) / 100;

  const offenOhneDaten = summe(ungedeckt);
  const monateOhneDaten = ungedeckt.map((p) => p.monat).sort();

  if (offenJe.length === 0) {
    // Alles Offene liegt vor den Kontodaten. Sichtbar machen, nie mahnen.
    if (offenOhneDaten < 1) return null;
    return {
      mietverhaeltnis_id: alleOffen[0].mietverhaeltnis_id,
      kontakt_name: alleOffen[0].kontakt_name,
      einheit: alleOffen[0].einheit,
      offen: 0,
      monatsmiete,
      aeltester_monat: monateOhneDaten[0],
      tage_ueberfaellig: 0,
      offen_ohne_daten: offenOhneDaten,
      monate_ohne_daten: monateOhneDaten,
      stufe: "faellig",
      begruendung:
        `${monateOhneDaten.length} Monate ohne Kontodaten ` +
        `(${monateOhneDaten[0].slice(0, 7)} bis ` +
        `${monateOhneDaten[monateOhneDaten.length - 1].slice(0, 7)}). ` +
        "Für diesen Zeitraum liegen keine Auszüge vor, es wird nicht " +
        "gemahnt -- das muss jemand von Hand klären.",
    };
  }

  const offen = summe(offenJe);

  // Centbeträge sind Rundungsreste aus anteiligen Monaten, keine
  // Rückstände. Ein Schreiben über 0,03 EUR beschädigt nur das Verhältnis.
  if (offen < 1 && offenOhneDaten < 1) return null;

  const erster = offenJe
    .map((p) => p.monat)
    .sort()[0];
  const [j, m] = erster.split("-").map(Number);
  const faellig = dritterWerktag(j, m);
  const tage = tageZwischen(faellig, heute);

  const vorlage = {
    mietverhaeltnis_id: offenJe[0].mietverhaeltnis_id,
    kontakt_name: offenJe[0].kontakt_name,
    einheit: offenJe[0].einheit,
    offen,
    monatsmiete,
    aeltester_monat: erster,
    tage_ueberfaellig: tage,
    offen_ohne_daten: offenOhneDaten,
    monate_ohne_daten: monateOhneDaten,
  };

  const eur = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(n);

  // Wer eine Mahnung freigibt, muss sehen, dass daneben ungeklärte Monate
  // stehen -- sonst schreibt er über 600 EUR, während in der Akte 7.000 EUR
  // ungeklärt sind, und wundert sich später.
  const zusatz =
    offenOhneDaten >= 1
      ? ` Daneben ${eur(offenOhneDaten)} aus ${monateOhneDaten.length} ` +
        "Monaten ohne Kontodaten -- nicht Teil dieser Forderung."
      : "";

  // Gedeckt ist nur Kleingeld, ungedeckt steht aber etwas offen: kein
  // Mahngrund, aber auch nicht wegwerfen -- die ungedeckten Monate bleiben
  // sichtbar.
  if (offen < 1) {
    return {
      ...vorlage,
      offen,
      stufe: "faellig",
      begruendung:
        `${eur(offenOhneDaten)} offen aus ${monateOhneDaten.length} Monaten ` +
        "ohne Kontodaten. Für die Zeit mit Auszügen ist nichts offen, " +
        "deshalb keine Mahnung.",
    };
  }

  // Noch nicht fällig: Der Monat läuft, die Schonfrist auch.
  if (tage < 0) {
    return {
      ...vorlage,
      stufe: "ok",
      begruendung:
        `${eur(offen)} offen, fällig erst am ` +
        `${faellig.toISOString().slice(0, 10)}.`,
    };
  }

  // Ohne bekannte Monatsmiete gibt es keine Schwelle -- und ohne Schwelle
  // wäre jeder offene Cent sofort ein Mahngrund. Genau das darf nicht
  // passieren: Betroffen wären die Mietverhältnisse, bei denen die Miete
  // nicht belegt ist, also gerade die unsicheren Fälle.
  //
  // Deshalb hier die Notbremse: sichtbar machen, aber niemals eskalieren.
  if (!(monatsmiete > 0)) {
    return {
      ...vorlage,
      stufe: "faellig",
      begruendung:
        `${eur(offen)} offen seit ${tage} Tagen. Die Monatsmiete ist nicht ` +
        "hinterlegt, deshalb gibt es keine Schwelle -- es wird bewusst " +
        "nicht gemahnt, bis der Betrag geklärt ist.",
    };
  }

  // Unter einer Monatsmiete: sichtbar, aber kein Schreiben. So bleibt die
  // Teilzahlung von jemandem, der 480 statt 580 überweist, im Blick, ohne
  // dass er sofort eine Mahnung bekommt.
  if (offen < monatsmiete) {
    return {
      ...vorlage,
      stufe: "faellig",
      begruendung:
        `${eur(offen)} offen seit ${tage} Tagen -- unter einer Monatsmiete ` +
        `(${eur(monatsmiete)}), deshalb kein Schreiben.`,
    };
  }

  if (tage >= 30) {
    return {
      ...vorlage,
      stufe: "mahnung",
      begruendung:
        `${eur(offen)} offen, ältester Monat ${erster.slice(0, 7)}, ` +
        `${tage} Tage über der Fälligkeit.` +
        (offen >= 2 * monatsmiete
          ? " Mehr als zwei Monatsmieten -- § 543 Abs. 2 Nr. 3 BGB wäre erfüllt."
          : "") + zusatz,
    };
  }

  if (tage >= 10) {
    return {
      ...vorlage,
      stufe: "erinnerung",
      begruendung:
        `${eur(offen)} offen, ${tage} Tage über der Fälligkeit. ` +
        "Zahlungserinnerung, noch keine Mahnung." + zusatz,
    };
  }

  return {
    ...vorlage,
    stufe: "faellig",
    begruendung:
      `${eur(offen)} offen seit ${tage} Tagen -- die Zahlungserinnerung ` +
      "geht erst ab dem zehnten Tag raus.",
  };
}

/**
 * Alle Rückstände, nach Dringlichkeit sortiert.
 *
 * Gruppiert die offenen Posten je Mietverhältnis und wendet stufeFuer an.
 * Die Monatsmiete kommt von außen, weil sie aus der Anpassungshistorie
 * stammt und hier nicht noch einmal hergeleitet werden soll.
 */
export function rueckstaende(
  posten: OffenerPosten[],
  monatsmieten: Map<string, number>,
  heute: Date,
): Rueckstand[] {
  const jeVertrag = new Map<string, OffenerPosten[]>();
  for (const p of posten) {
    const liste = jeVertrag.get(p.mietverhaeltnis_id) ?? [];
    liste.push(p);
    jeVertrag.set(p.mietverhaeltnis_id, liste);
  }

  const rang: Record<Stufe, number> = {
    mahnung: 0,
    erinnerung: 1,
    faellig: 2,
    ok: 3,
  };

  return [...jeVertrag.entries()]
    .map(([id, liste]) =>
      stufeFuer(liste, monatsmieten.get(id) ?? 0, heute),
    )
    .filter((r): r is Rueckstand => r !== null)
    .sort(
      (a, b) =>
        rang[a.stufe] - rang[b.stufe] ||
        b.offen - a.offen ||
        a.kontakt_name.localeCompare(b.kontakt_name, "de"),
    );
}
