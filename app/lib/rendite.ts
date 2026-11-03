import { tx } from "./db";
import {
  einheitenDesObjekts,
  objektKennzahlen,
  type ObjektEinheit,
} from "./objekte";

/**
 * Netto-Mietrendite und die wirtschaftlichen Kennzahlen eines Objekts.
 *
 * Aufgebaut wie lib/kennzahlen.ts, und aus demselben Grund:
 *
 *   OBEN   reine Rechnerei. Kein Datenbankzugriff, kein `new Date()` ohne
 *          Übergabe. Jede Funktion hat ein von Hand nachgerechnetes
 *          Beispiel in tests/rendite.test.ts.
 *   UNTEN  das Laden. Nur Abfragen und Zusammenstellen; gerechnet wird
 *          dort nichts.
 *
 * Eine Rendite ist die Zahl, bei der niemand nachrechnet. Sie steht am Ende
 * einer Kette aus zehn gepflegten Feldern und vier Abfragen, und wenn ein
 * Glied fehlt, sieht das Ergebnis genauso aus wie ein richtiges. Deshalb ist
 * die wichtigste Regel dieser Datei eine Verneinung, dieselbe wie in
 * lib/kennzahlen.ts: **Eine Kennzahl ohne Grundlage behauptet keine Zahl.**
 * Sie ist dann `null` und sagt in `grund`, was fehlt.
 *
 * Was das konkret heißt:
 *   - Keine Rendite ohne Kaufpreis. Nicht 0 %, nicht "n/a".
 *   - Keine Bewirtschaftungskosten von 0 €, solange kein einziger Beleg
 *     erfasst ist. "Keine Kosten" und "keine Kostendaten" sind zwei
 *     verschiedene Aussagen, und die zweite ist die häufigere.
 *   - Keine Miete je m², wenn die halbe Fläche fehlt.
 *   - Negative Renditen werden gezeigt, nicht auf 0 geklemmt. Ein Objekt,
 *     das Geld kostet, soll auch so aussehen.
 *
 * ---------------------------------------------------------------------------
 * Das Modell: Rohertrag minus ALLE Kosten
 * ---------------------------------------------------------------------------
 *
 * Der Rohertrag ist alles, was der Mieter schuldet -- Kaltmiete plus
 * Nebenkostenvorauszahlung plus Möblierungszuschlag. Die
 * Bewirtschaftungskosten sind alle Kosten des Objekts, umlagefähige wie
 * nicht umlagefähige (§ 2 BetrKV und das, was § 1 Abs. 2 BetrKV
 * ausnimmt -- siehe lib/kostenarten.ts).
 *
 * Das ist eine bewusste Entscheidung gegen das sonst übliche Modell
 * "Nettokaltmiete minus nicht umlagefähige Kosten": Rund zwei Drittel der
 * WG-Zimmer sind als Inklusivmiete vermietet ("500 € all-in, keine
 * Nebenkosten") und haben gar keine getrennte Kaltmiete --
 * mietzusammensetzung() in lib/dokumente.ts nennt diesen Fall `inklusiv`.
 * Jedes Modell, das eine Nettokaltmiete braucht, müsste für diese
 * Mietverhältnisse eine Aufteilung erfinden, und eine erfundene Aufteilung
 * ist genau die Art Zahl, die diese Anwendung nicht anzeigt.
 *
 * Rohertrag minus alle Kosten umgeht das vollständig und ist zugleich der
 * Reinertrag im Sinne der Wertermittlung (§ 31 ff. ImmoWertV). Die Zahl ist
 * damit niedriger als eine "Netto-Mietrendite", die nur die nicht
 * umlagefähigen Kosten abzieht -- und sie ist die, die am Jahresende auf dem
 * Konto übrig bleibt.
 */

// ===========================================================================
// Reine Rechnerei
// ===========================================================================

/** Auf Cent, damit sich Fließkommareste nicht aufsummieren. */
function cent(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Summe mehrerer Geldbeträge, auf Cent.
 *
 * Eigene Funktion, weil die naive Addition von drei `numeric(10,2)`-Werten
 * im Binärformat Reste hinterlässt: 199.99 + 199.99 + 200.01 ergibt in
 * JavaScript 599.9899999999999. Auf dem Schirm wäre das "599,99 €" --
 * in einem Vergleich auf Gleichheit aber nicht derselbe Betrag.
 */
export function summeCent(werte: number[]): number {
  return cent(werte.reduce((s, w) => s + w, 0));
}

/** Die Maßeinheit eines Kennwerts. Formatiert wird in der Oberfläche. */
export type Masseinheit = "prozent" | "euro" | "faktor" | "euro_je_qm" | "jahre";

export interface Kennwert {
  /** null heisst: nicht berechenbar. Dann steht in `grund`, was fehlt. */
  wert: number | null;
  /** Was fehlt, in einem Satz, den der Eigentümer lesen kann. */
  grund: string | null;
  /** Woraus gerechnet wurde -- nachprüfbar, nicht geschätzt. */
  grundlage: string;
  einheit: Masseinheit;
}

/** Ein Kennwert mit Zahl. Quoten als Bruchzahl: 0,0412 für 4,12 %. */
function wert(zahl: number, grundlage: string, einheit: Masseinheit): Kennwert {
  return { wert: zahl, grund: null, grundlage, einheit };
}

/** Ein Kennwert ohne Zahl. `grund` sagt, was fehlt -- nicht, dass es fehlt. */
function ohne(grund: string, grundlage: string, einheit: Masseinheit): Kennwert {
  return { wert: null, grund, grundlage, einheit };
}

/**
 * Übernimmt das Fehlen einer Vorstufe.
 *
 * Ohne das trüge jede abgeleitete Kennzahl denselben leeren Satz ("nicht
 * berechenbar"), und der Eigentümer müsste raten, welches der zehn Felder
 * er nachtragen soll. So steht beim Reinertragsfaktor der Satz, der beim
 * Kaufpreis fehlt.
 */
function geerbt(vorstufe: Kennwert, einheit: Masseinheit): Kennwert {
  return {
    wert: null,
    grund: vorstufe.grund,
    grundlage: vorstufe.grundlage,
    einheit,
  };
}

const EUR = (n: number) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Die Eingangsgrößen
// ---------------------------------------------------------------------------

/**
 * Die gepflegten Felder am Objekt -- genau die Spalten aus db/030.
 *
 * Die Schlüssel heißen wörtlich wie die Spalten. tests/rendite.test.ts hält
 * das fest: Ein Tippfehler hier würde still zu `null` werden und damit zu
 * einer Kennzahl, die "Kaufpreis fehlt" sagt, obwohl er erfasst ist.
 */
export interface WirtschaftStamm {
  kaufpreis: number | null;
  kaufnebenkosten: number | null;
  kaufdatum: string | null;
  verkehrswert: number | null;
  bewirtschaftung_jahr: number | null;
  instandhaltung_je_qm: number | null;
  mietausfallwagnis_satz: number | null;
  darlehen_restschuld: number | null;
  darlehen_zins_satz: number | null;
  darlehen_rate_monat: number | null;
}

/**
 * Was aus dem Bestand gemessen wird: Mieten, Sollstellungen, Belege, Flächen.
 *
 * Jede Zählgröße steht neben ihrem Betrag -- `belege` neben `belegkosten`,
 * `gestellteMonate` neben `sollGestellt`. Das ist der ganze Trick dieser
 * Datei: Ohne die Anzahl lässt sich ein Betrag von 0 € nicht von einem
 * fehlenden Betrag unterscheiden.
 */
export interface WirtschaftBasis {
  /** Erster Tag des Zwölfmonatsfensters (einschließlich). */
  fensterVon: string;
  /** Erster Tag nach dem Fenster (ausschließlich). */
  fensterBis: string;

  /** Heute gültiges Monatssoll aller laufenden Mietverhältnisse. */
  sollMonat: number;
  /** Laufende Mietverhältnisse dahinter. 0 = keine Vertragssicht möglich. */
  mietverhaeltnisse: number;

  /** Summe der Sollstellungen im Fenster. */
  sollGestellt: number;
  /** Monate mit mindestens einer Sollstellung. 0 = nichts gestellt. */
  gestellteMonate: number;

  /** Summe `beleg.betrag_brutto` des Objekts im Fenster. */
  belegkosten: number;
  /** Belege dahinter. 0 = keine Kostendaten, nicht "keine Kosten". */
  belege: number;
  /** Davon Kostenart "finanzierung" -- siehe bewirtschaftungskosten(). */
  belegeFinanzierung: number;

  /** Erfasste Fläche der Einheiten mit laufendem Vertrag, in m². */
  flaeche: number;
  /** Einheiten mit laufendem Vertrag. */
  belegteEinheiten: number;
  /** Davon mit Flächenangabe. */
  belegteEinheitenMitFlaeche: number;

  /** Fälliges Soll abgeschlossener Monate im Fenster, nur mit Kontodaten. */
  sollFaellig: number;
  /** Darauf zugeordnetes Ist. */
  istZugeordnet: number;
  /** Abgeschlossene Monate mit Kontodaten im Fenster. 0 = keine Aussage. */
  monateMitKontodaten: number;
}

// ---------------------------------------------------------------------------
// Gesamtinvest
// ---------------------------------------------------------------------------

/**
 * Kaufpreis plus Kaufnebenkosten -- der Nenner jeder Rendite.
 *
 * Fehlende Nebenkosten werden als 0 gerechnet und das in der Grundlage
 * gesagt. Das ist die einzige Stelle, an der diese Datei eine Lücke füllt,
 * und sie ist die sichere Richtung: Ein zu kleiner Nenner macht die Rendite
 * zu GUT, also steht der Hinweis daneben.
 *
 * Ein Kaufpreis von 0 gilt als nicht brauchbar, nicht als geschenkt. Sonst
 * stünde bei einem Objekt mit 12.000 € Nebenkosten eine Rendite von 400 %.
 */
export function gesamtinvest(s: WirtschaftStamm): Kennwert {
  if (s.kaufpreis === null) {
    return ohne(
      "Für dieses Objekt ist kein Kaufpreis erfasst. Ohne Kaufpreis und " +
        "Kaufnebenkosten gibt es keinen Betrag, auf den sich eine Rendite " +
        "beziehen könnte.",
      "Kaufpreis nicht erfasst.",
      "euro",
    );
  }
  if (s.kaufpreis <= 0) {
    return ohne(
      `Der erfasste Kaufpreis ist ${EUR(s.kaufpreis)} €. Eine Rendite auf ` +
        "einen Kaufpreis von null ist keine Zahl, sondern eine Division " +
        "durch null.",
      `Kaufpreis ${EUR(s.kaufpreis)} €.`,
      "euro",
    );
  }

  const nk = s.kaufnebenkosten ?? 0;
  const summe = summeCent([s.kaufpreis, nk]);
  const grundlage =
    s.kaufnebenkosten === null
      ? `Kaufpreis ${EUR(s.kaufpreis)} €, Kaufnebenkosten nicht erfasst ` +
        "(als 0 € gerechnet -- die Rendite fällt dadurch zu gut aus)."
      : `Kaufpreis ${EUR(s.kaufpreis)} € plus Kaufnebenkosten ${EUR(nk)} €.`;

  return wert(summe, grundlage, "euro");
}

// ---------------------------------------------------------------------------
// Rohertrag: zwei Sichten
// ---------------------------------------------------------------------------

/**
 * Was das Haus KANN: zwölf Mal das heute gültige Monatssoll.
 *
 * Kennt keinen Leerstand und keine anteiligen Monate -- ein Zimmer, das seit
 * acht Monaten leer steht, kommt hier gar nicht vor, weil es kein laufendes
 * Mietverhältnis hat. Die Zahl ist deshalb die Obergrenze und nicht das,
 * was im letzten Jahr gefordert war.
 */
export function rohertragLautVertrag(b: WirtschaftBasis): Kennwert {
  if (b.mietverhaeltnisse === 0) {
    return ohne(
      "Für dieses Objekt ist kein laufendes Mietverhältnis erfasst.",
      "Keine laufenden Mietverhältnisse.",
      "euro",
    );
  }
  if (b.sollMonat <= 0) {
    return ohne(
      `Die ${b.mietverhaeltnisse} laufenden Mietverhältnisse dieses Objekts ` +
        "haben keine erfassten Mietbeträge.",
      `${b.mietverhaeltnisse} laufende Mietverhältnisse ohne Mietbetrag.`,
      "euro",
    );
  }
  return wert(
    cent(12 * b.sollMonat),
    `12 × ${EUR(b.sollMonat)} € Monatssoll aus ${b.mietverhaeltnisse} ` +
      "laufenden Mietverhältnissen, Stand heute. Ohne Leerstand.",
    "euro",
  );
}

/**
 * Was tatsächlich gefordert war: die Sollstellungen der letzten zwölf Monate.
 *
 * Leerstand, Mieterwechsel und anteilige Monate stecken darin schon drin --
 * ein leeres Zimmer erzeugt keine Sollstellung. Deshalb ist das die
 * Vorgabesicht für die Netto-Mietrendite.
 *
 * Der Haken, und er steht in der Grundlage: Deckt das Fenster weniger als
 * zwölf Monate ab (übernommenes Objekt, Abrechnung erst ab einem Stichtag,
 * Nachtlauf noch nicht gelaufen), ist die Summe kein Jahresbetrag. Die Zahl
 * wird dann nicht hochgerechnet -- hochrechnen heißt erfinden.
 */
export function rohertragGestellt(b: WirtschaftBasis): Kennwert {
  if (b.gestellteMonate === 0) {
    return ohne(
      "Für die letzten zwölf Monate sind für dieses Objekt keine " +
        "Sollstellungen erfasst. Es gibt damit keinen gestellten Rohertrag -- " +
        "die Vertragssicht daneben sagt, was das Haus könnte.",
      `Keine Sollstellungen zwischen ${b.fensterVon} und ${b.fensterBis}.`,
      "euro",
    );
  }
  const vollstaendig = b.gestellteMonate >= 12;
  return wert(
    cent(b.sollGestellt),
    `Summe der Sollstellungen von ${b.fensterVon} bis ${b.fensterBis} über ` +
      `${b.gestellteMonate} Monate` +
      (vollstaendig
        ? ". Leerstand und anteilige Monate sind darin enthalten."
        : ` -- nicht die vollen zwölf. Die Summe ist daher kein Jahresbetrag ` +
          `und wird nicht hochgerechnet; jede Rendite daraus fällt zu ` +
          `niedrig aus.`),
    "euro",
  );
}

// ---------------------------------------------------------------------------
// Bewirtschaftungskosten
// ---------------------------------------------------------------------------

/**
 * Alle Kosten des Objekts im Jahr: Belege plus Ansätze.
 *
 * Drei Bestandteile, jeder einzeln verzichtbar und jeder einzeln benannt:
 *
 *   1. Die Belegsumme der letzten zwölf Monate -- ODER, wenn
 *      `bewirtschaftung_jahr` gesetzt ist, dieser Wert STATT der
 *      Belegsumme. Der manuelle Ansatz ersetzt nur die Belege, nicht die
 *      beiden Ansätze darunter; die sind keine Belege, sondern Vorsorge.
 *   2. Das Mietausfallwagnis, Satz × Rohertrag.
 *   3. Der Instandhaltungsansatz, €/m² × Fläche.
 *
 * Ist weder `bewirtschaftung_jahr` gesetzt noch ein einziger Beleg erfasst,
 * gibt es keine Kostenseite -- und dann keine Zahl. Eine Belegsumme von 0 €
 * bei null Belegen würde zu einem Reinertrag in Höhe des Rohertrags führen
 * und damit zu einer Rendite, die etwa doppelt so hoch wäre wie die
 * wirkliche. Das ist der teuerste Fehler, den diese Datei machen kann, und
 * der einzige, der dabei gut aussieht.
 *
 * Zur Doppelzählung, zwei Stellen, beide absichtlich nicht automatisch
 * bereinigt (die Anwendung kann nicht wissen, was gemeint ist -- sie sagt
 * es stattdessen):
 *   - Sind Instandhaltungsbelege erfasst UND ein €/m²-Ansatz gepflegt,
 *     steht die Instandhaltung zweimal drin. Der Ansatz ist für den Fall
 *     gedacht, dass die Belege zu dünn sind.
 *   - Belege der Kostenart "finanzierung" sind Zinsen. Die stecken auch in
 *     der Annuität, mit der cashflowJahr() rechnet.
 */
export function bewirtschaftungskosten(
  s: WirtschaftStamm,
  b: WirtschaftBasis,
  rohertrag: number | null,
): Kennwert {
  const teile: number[] = [];
  const grundlagen: string[] = [];

  // 1. Belegsumme oder manueller Ansatz.
  if (s.bewirtschaftung_jahr !== null) {
    teile.push(s.bewirtschaftung_jahr);
    grundlagen.push(
      `Jahresansatz ${EUR(s.bewirtschaftung_jahr)} € von Hand erfasst` +
        (b.belege > 0
          ? ` (statt der ${b.belege} Belege über ${EUR(b.belegkosten)} €)`
          : " (keine Belege erfasst)"),
    );
  } else if (b.belege > 0) {
    teile.push(b.belegkosten);
    grundlagen.push(
      `${b.belege} Belege über ${EUR(b.belegkosten)} € von ${b.fensterVon} ` +
        `bis ${b.fensterBis}, umlagefähige wie nicht umlagefähige` +
        (b.belegeFinanzierung > 0
          ? `; darunter ${b.belegeFinanzierung} Belege der Kostenart ` +
            "„Zinsen und Finanzierung“, die auch in der Darlehensrate stecken"
          : ""),
    );
  } else {
    return ohne(
      "Für dieses Objekt ist in den letzten zwölf Monaten kein Beleg " +
        "erfasst, und es gibt keinen Jahresansatz. Die Kosten sind damit " +
        "nicht bekannt -- 0 € wären hier keine Sparsamkeit, sondern eine " +
        "Lücke, und die Rendite daraus etwa doppelt so hoch wie die " +
        "wirkliche. Entweder Belege erfassen oder einen Jahresansatz " +
        "eintragen.",
      `Keine Belege zwischen ${b.fensterVon} und ${b.fensterBis}, kein ` +
        "Jahresansatz.",
      "euro",
    );
  }

  // 2. Mietausfallwagnis.
  if (s.mietausfallwagnis_satz !== null) {
    if (rohertrag === null) {
      return ohne(
        `Das Mietausfallwagnis ist mit ${EUR(s.mietausfallwagnis_satz)} % ` +
          "des Rohertrags erfasst, aber der Rohertrag selbst lässt sich " +
          "nicht ermitteln.",
        "Mietausfallwagnis ohne Rohertrag.",
        "euro",
      );
    }
    const wagnis = cent((s.mietausfallwagnis_satz / 100) * rohertrag);
    teile.push(wagnis);
    grundlagen.push(
      `Mietausfallwagnis ${EUR(s.mietausfallwagnis_satz)} % von ` +
        `${EUR(rohertrag)} € Rohertrag = ${EUR(wagnis)} €`,
    );
  } else {
    grundlagen.push("ohne Mietausfallwagnis (kein Satz erfasst)");
  }

  // 3. Instandhaltungsansatz.
  if (s.instandhaltung_je_qm !== null) {
    if (b.flaeche <= 0) {
      return ohne(
        `Der Instandhaltungsansatz ist mit ${EUR(s.instandhaltung_je_qm)} ` +
          "€/m² erfasst, aber für die vermieteten Einheiten dieses Objekts " +
          "ist keine Fläche hinterlegt.",
        "Instandhaltungsansatz ohne Fläche.",
        "euro",
      );
    }
    const ih = cent(s.instandhaltung_je_qm * b.flaeche);
    teile.push(ih);
    grundlagen.push(
      `Instandhaltungsansatz ${EUR(s.instandhaltung_je_qm)} €/m² × ` +
        `${EUR(b.flaeche)} m² = ${EUR(ih)} €`,
    );
  }

  return wert(summeCent(teile), grundlagen.join("; ") + ".", "euro");
}

// ---------------------------------------------------------------------------
// Reinertrag, Renditen, Faktoren
// ---------------------------------------------------------------------------

/**
 * Rohertrag minus Bewirtschaftungskosten.
 *
 * Darf negativ sein und wird dann negativ gezeigt. Ein Haus, dessen Kosten
 * den Rohertrag übersteigen -- im Sanierungsjahr der Normalfall --, soll
 * nicht wie ein Haus mit 0 € Ertrag aussehen. Auf 0 geklemmt wäre die
 * schlechteste Nachricht genau die, die nicht ankommt.
 */
export function jahresreinertrag(
  rohertrag: Kennwert,
  bewirtschaftung: Kennwert,
): Kennwert {
  if (rohertrag.wert === null) return geerbt(rohertrag, "euro");
  if (bewirtschaftung.wert === null) return geerbt(bewirtschaftung, "euro");
  return wert(
    cent(rohertrag.wert - bewirtschaftung.wert),
    `${EUR(rohertrag.wert)} € Rohertrag minus ${EUR(bewirtschaftung.wert)} € ` +
      "Bewirtschaftungskosten.",
    "euro",
  );
}

/**
 * Ein Ertrag im Verhältnis zum eingesetzten Geld, als Bruchzahl.
 *
 * 0,0412 heißt 4,12 % -- die Formatierung macht die Oberfläche. Der Nenner
 * wird gegen 0 geprüft; ein Infinity sieht auf dem Schirm wie ein Fehler des
 * Bildschirms aus und nicht wie ein fehlender Kaufpreis.
 */
function renditeAuf(
  ertrag: Kennwert,
  invest: Kennwert,
  was: string,
): Kennwert {
  if (ertrag.wert === null) return geerbt(ertrag, "prozent");
  if (invest.wert === null) return geerbt(invest, "prozent");
  if (invest.wert === 0) {
    return ohne(
      "Der Gesamtinvest ist 0 €. Darauf lässt sich keine Rendite rechnen.",
      "Gesamtinvest 0 €.",
      "prozent",
    );
  }
  return wert(
    ertrag.wert / invest.wert,
    `${EUR(ertrag.wert)} € ${was} ÷ ${EUR(invest.wert)} € Gesamtinvest.`,
    "prozent",
  );
}

/** Rohertrag ÷ Gesamtinvest. Kennt keine Kosten -- bewusst. */
export function bruttomietrendite(
  rohertrag: Kennwert,
  invest: Kennwert,
): Kennwert {
  return renditeAuf(rohertrag, invest, "Rohertrag");
}

/** Reinertrag ÷ Gesamtinvest. Die Zahl, nach der gefragt wird. */
export function nettomietrendite(
  reinertrag: Kennwert,
  invest: Kennwert,
): Kennwert {
  return renditeAuf(reinertrag, invest, "Reinertrag");
}

/**
 * Der Vervielfältiger: Gesamtinvest ÷ Ertrag.
 *
 * "Das Haus kostet 21 Jahresmieten." Bei einem Ertrag von 0 oder darunter
 * gibt es keinen Vervielfältiger: Ein negativer Faktor liest sich wie eine
 * kurze Amortisation und ist das Gegenteil davon.
 */
export function faktor(invest: Kennwert, ertrag: Kennwert, was: string): Kennwert {
  if (invest.wert === null) return geerbt(invest, "jahre");
  if (ertrag.wert === null) return geerbt(ertrag, "jahre");
  if (ertrag.wert <= 0) {
    return ohne(
      `Der ${was} ist ${EUR(ertrag.wert)} € und damit nicht positiv. Ein ` +
        "Vervielfältiger wäre hier ohne Aussage -- das Objekt verdient " +
        "nichts, was sich vervielfachen ließe.",
      `${was} ${EUR(ertrag.wert)} €.`,
      "jahre",
    );
  }
  return wert(
    invest.wert / ertrag.wert,
    `${EUR(invest.wert)} € Gesamtinvest ÷ ${EUR(ertrag.wert)} € ${was}.`,
    "jahre",
  );
}

// ---------------------------------------------------------------------------
// Finanzierung
// ---------------------------------------------------------------------------

/**
 * Gesamtinvest minus Restschuld -- eine Näherung, und zwar eine grobe.
 *
 * Richtig wäre: eingesetztes Eigenkapital plus getilgter Anteil plus
 * Wertveränderung. Hier steht stattdessen der Gesamtinvest von damals minus
 * die Restschuld von heute. Der Fehler liegt in der Wertveränderung: Ist das
 * Objekt seit dem Kauf im Wert gestiegen, ist das wirkliche Eigenkapital
 * höher und die Eigenkapitalrendite darunter entsprechend zu gut. Wer es
 * genauer will, pflegt `verkehrswert`.
 *
 * Ohne erfasste Restschuld gibt es keine Zahl. Ein schuldenfreies Objekt
 * wird mit 0 eingetragen -- das ist eine Aussage, NULL ist keine.
 */
export function eigenkapital(s: WirtschaftStamm, invest: Kennwert): Kennwert {
  if (invest.wert === null) return geerbt(invest, "euro");
  if (s.darlehen_restschuld === null) {
    return ohne(
      "Für dieses Objekt ist keine Darlehensrestschuld erfasst. Bei einem " +
        "schuldenfreien Objekt gehört dort eine 0 hin; leer heißt " +
        "„unbekannt“, und daraus wird hier kein Eigenkapital abgeleitet.",
      "Darlehensrestschuld nicht erfasst.",
      "euro",
    );
  }
  return wert(
    cent(invest.wert - s.darlehen_restschuld),
    `${EUR(invest.wert)} € Gesamtinvest minus ` +
      `${EUR(s.darlehen_restschuld)} € Restschuld. Näherung: ohne ` +
      "Wertveränderung seit dem Kauf.",
    "euro",
  );
}

/**
 * Reinertrag minus Kapitaldienst eines Jahres.
 *
 * Gerechnet wird mit der ganzen Annuität, also Zins plus Tilgung. Das ist
 * nicht das steuerliche Ergebnis (Tilgung ist kein Aufwand, Abschreibung
 * fehlt hier ganz), sondern die Frage "wie viel Geld bleibt auf dem
 * Konto?". Beides zu vermischen wäre der Fehler, den eine
 * Tabellenkalkulation an dieser Stelle regelmäßig macht.
 */
export function cashflowJahr(
  reinertrag: Kennwert,
  s: WirtschaftStamm,
): Kennwert {
  if (reinertrag.wert === null) return geerbt(reinertrag, "euro");
  if (s.darlehen_rate_monat === null) {
    return ohne(
      "Für dieses Objekt ist keine monatliche Darlehensrate erfasst. Bei " +
        "einem schuldenfreien Objekt gehört dort eine 0 hin.",
      "Darlehensrate nicht erfasst.",
      "euro",
    );
  }
  const kapitaldienst = cent(12 * s.darlehen_rate_monat);
  return wert(
    cent(reinertrag.wert - kapitaldienst),
    `${EUR(reinertrag.wert)} € Reinertrag minus 12 × ` +
      `${EUR(s.darlehen_rate_monat)} € Annuität (${EUR(kapitaldienst)} € ` +
      "Kapitaldienst, Zins und Tilgung). Ohne Abschreibung und Steuer.",
    "euro",
  );
}

/** Cashflow ÷ Eigenkapital. Darf negativ sein. */
export function eigenkapitalrendite(
  cashflow: Kennwert,
  kapital: Kennwert,
): Kennwert {
  if (cashflow.wert === null) return geerbt(cashflow, "prozent");
  if (kapital.wert === null) return geerbt(kapital, "prozent");
  if (kapital.wert === 0) {
    return ohne(
      "Das errechnete Eigenkapital ist 0 € -- die Restschuld entspricht " +
        "dem Gesamtinvest. Eine Eigenkapitalrendite gibt es dann nicht.",
      "Eigenkapital 0 €.",
      "prozent",
    );
  }
  return wert(
    cashflow.wert / kapital.wert,
    `${EUR(cashflow.wert)} € Cashflow ÷ ${EUR(kapital.wert)} € Eigenkapital.`,
    "prozent",
  );
}

/**
 * Reinertrag ÷ Jahreszins. Wie oft der Ertrag die Zinsen deckt.
 *
 * Unter 1 heißt: Das Objekt verdient seine Zinsen nicht, von der Tilgung
 * ganz zu schweigen. Das ist die Zahl, die eine Bank bei der
 * Prolongation ansieht.
 */
export function zinsdeckung(
  reinertrag: Kennwert,
  s: WirtschaftStamm,
): Kennwert {
  if (reinertrag.wert === null) return geerbt(reinertrag, "faktor");
  if (s.darlehen_restschuld === null || s.darlehen_zins_satz === null) {
    const fehlend =
      s.darlehen_restschuld === null && s.darlehen_zins_satz === null
        ? "Restschuld und Zinssatz"
        : s.darlehen_restschuld === null
          ? "die Restschuld"
          : "der Zinssatz";
    return ohne(
      `Für die Zinsdeckung fehlt ${fehlend} des Darlehens.`,
      "Darlehensdaten unvollständig.",
      "faktor",
    );
  }
  const zins = cent((s.darlehen_restschuld * s.darlehen_zins_satz) / 100);
  if (zins <= 0) {
    return ohne(
      "Es fällt kein Zins an (Restschuld oder Zinssatz ist 0). Eine " +
        "Zinsdeckung ist dann ohne Aussage -- es gibt nichts zu decken.",
      `Jahreszins ${EUR(zins)} €.`,
      "faktor",
    );
  }
  return wert(
    reinertrag.wert / zins,
    `${EUR(reinertrag.wert)} € Reinertrag ÷ ${EUR(zins)} € Jahreszins ` +
      `(${EUR(s.darlehen_restschuld)} € × ${s.darlehen_zins_satz} %).`,
    "faktor",
  );
}

// ---------------------------------------------------------------------------
// Miete je m²
// ---------------------------------------------------------------------------

/**
 * Monatssoll ÷ erfasste Fläche der vermieteten Einheiten.
 *
 * Die Strenge hier hat denselben Grund wie bei `ohneFlaeche` in
 * lib/objekte.ts: Eine Summe aus halben Angaben sieht vollständig aus. Sind
 * nur vier von neun Zimmern mit Fläche erfasst, steht im Zähler die Miete
 * von neun Zimmern und im Nenner die Fläche von vier -- das Ergebnis wäre
 * gut doppelt so hoch wie die Wahrheit, und zwar in genau der Größenordnung,
 * in der eine Miete je m² noch plausibel aussieht.
 *
 * Deshalb: weniger als die Hälfte der vermieteten Einheiten mit Fläche
 * ergibt keine Zahl. Darüber steht die Zahl, und die Grundlage nennt, über
 * wie viele Einheiten die Fläche erfasst ist.
 */
export function mieteJeQmMonat(b: WirtschaftBasis): Kennwert {
  if (b.belegteEinheiten === 0) {
    return ohne(
      "Für dieses Objekt ist keine vermietete Einheit erfasst.",
      "Keine vermieteten Einheiten.",
      "euro_je_qm",
    );
  }
  const ohneFlaeche = b.belegteEinheiten - b.belegteEinheitenMitFlaeche;
  if (b.belegteEinheitenMitFlaeche * 2 < b.belegteEinheiten) {
    return ohne(
      `Von ${b.belegteEinheiten} vermieteten Einheiten haben ${ohneFlaeche} ` +
        "keine Flächenangabe. Die Miete je m² würde dann die Miete aller " +
        "Einheiten auf die Fläche weniger Einheiten verteilen und damit " +
        "deutlich zu hoch ausfallen.",
      `Fläche über ${b.belegteEinheitenMitFlaeche} von ` +
        `${b.belegteEinheiten} vermieteten Einheiten erfasst.`,
      "euro_je_qm",
    );
  }
  if (b.flaeche <= 0) {
    return ohne(
      "Für die vermieteten Einheiten dieses Objekts ist keine Fläche " +
        "größer als 0 m² erfasst.",
      `Erfasste Fläche ${EUR(b.flaeche)} m².`,
      "euro_je_qm",
    );
  }
  return wert(
    b.sollMonat / b.flaeche,
    `${EUR(b.sollMonat)} € Monatssoll ÷ ${EUR(b.flaeche)} m² Fläche; ` +
      `erfasst über ${b.belegteEinheitenMitFlaeche} von ` +
      `${b.belegteEinheiten} vermieteten Einheiten` +
      (ohneFlaeche > 0 ? ` (${ohneFlaeche} ohne Angabe)` : "") +
      ".",
    "euro_je_qm",
  );
}

// ---------------------------------------------------------------------------
// Zahlungstreue
// ---------------------------------------------------------------------------

/**
 * Beide Quoten rechnen ausschließlich über abgeschlossene Monate MIT
 * Kontodaten (`objekt.zahlungsdaten_ab`, db/023). Das ist nicht Vorsicht,
 * sondern die Kernregel dieser Anwendung: Ein Monat ohne Kontoauszug ist
 * nicht unbezahlt, sondern unbekannt. Die Begründung steht ausführlich in
 * db/023 und in lib/mahnstufen.ts -- in Ludwigshafen wären es sonst über
 * zwanzig Monatsmieten Rückstand, die es nie gab.
 *
 * Über dasselbe Fenster ergänzen sich die beiden Quoten zu 1. Sie stehen
 * trotzdem beide da: Der Eigentümer liest die eine als Risiko und die
 * andere als Leistung, und eine Oberfläche, die nur die freundliche zeigt,
 * wäre nicht ehrlicher, nur stiller.
 */
export function mietausfallquote(b: WirtschaftBasis): Kennwert {
  if (b.monateMitKontodaten === 0 || b.sollFaellig <= 0) {
    return ohne(
      "Für dieses Objekt gibt es im letzten Jahr keinen abgeschlossenen " +
        "Monat mit Kontodaten. Ohne Kontoauszug ist ein Monat nicht " +
        "unbezahlt, sondern unbekannt -- daraus wird hier keine " +
        "Ausfallquote.",
      "Keine abgeschlossenen Monate mit Kontodaten.",
      "prozent",
    );
  }
  const rueckstand = cent(b.sollFaellig - b.istZugeordnet);
  return wert(
    rueckstand / b.sollFaellig,
    `${EUR(rueckstand)} € Rückstand ÷ ${EUR(b.sollFaellig)} € fälliges Soll ` +
      `über ${b.monateMitKontodaten} abgeschlossene Monate mit Kontodaten.`,
    "prozent",
  );
}

/** Zugeordnetes Ist ÷ fälliges Soll, nur Monate mit Kontodaten. */
export function inkassoquote(b: WirtschaftBasis): Kennwert {
  if (b.monateMitKontodaten === 0 || b.sollFaellig <= 0) {
    return ohne(
      "Für dieses Objekt gibt es im letzten Jahr keinen abgeschlossenen " +
        "Monat mit Kontodaten. Eine Inkassoquote von 100 % wäre hier eine " +
        "Behauptung über Daten, die es nicht gibt.",
      "Keine abgeschlossenen Monate mit Kontodaten.",
      "prozent",
    );
  }
  return wert(
    b.istZugeordnet / b.sollFaellig,
    `${EUR(b.istZugeordnet)} € zugeordnetes Ist ÷ ${EUR(b.sollFaellig)} € ` +
      `fälliges Soll über ${b.monateMitKontodaten} abgeschlossene Monate ` +
      "mit Kontodaten.",
    "prozent",
  );
}

// ---------------------------------------------------------------------------
// Alles zusammen
// ---------------------------------------------------------------------------

export interface WirtschaftLage {
  gesamtinvest: Kennwert;
  /** 12 × heutiges Soll -- was das Haus kann. */
  rohertragLautVertrag: Kennwert;
  /** Sollstellungen der letzten zwölf Monate -- was gefordert war. */
  rohertragGestellt: Kennwert;
  bewirtschaftung: Kennwert;
  /** Aus `rohertragGestellt` -- Leerstand steckt darin. */
  jahresreinertrag: Kennwert;
  bruttomietrendite: Kennwert;
  /** Die Vorgabezahl: aus dem gestellten Rohertrag. */
  nettomietrendite: Kennwert;
  /** Dieselbe Rechnung aus der Vertragssicht -- die Obergrenze. */
  nettomietrenditeLautVertrag: Kennwert;
  /** Netto-Mietrendite auf den heutigen Wert statt auf den Kaufpreis. */
  nettomietrenditeAufVerkehrswert: Kennwert;
  rohertragsfaktor: Kennwert;
  reinertragsfaktor: Kennwert;
  eigenkapital: Kennwert;
  cashflowJahr: Kennwert;
  eigenkapitalrendite: Kennwert;
  zinsdeckung: Kennwert;
  mieteJeQmMonat: Kennwert;
  mietausfallquote: Kennwert;
  inkassoquote: Kennwert;
}

/**
 * Die ganze Lage aus Stammdaten und gemessener Basis.
 *
 * Die Netto-Mietrendite kommt voreingestellt aus `rohertragGestellt`, weil
 * Leerstand und anteilige Monate darin schon stecken. Daneben steht
 * `nettomietrenditeLautVertrag` aus zwölf heutigen Monatsmieten. Die
 * Differenz zwischen beiden ist genau der Preis des Leerstands im letzten
 * Jahr -- und eine Oberfläche, die nur die Vertragssicht zeigt, würde ein
 * halb leeres Haus wie ein volles aussehen lassen.
 */
export function wirtschaftLage(
  s: WirtschaftStamm,
  b: WirtschaftBasis,
): WirtschaftLage {
  const invest = gesamtinvest(s);
  const vertrag = rohertragLautVertrag(b);
  const gestellt = rohertragGestellt(b);

  // Die Kostenseite hängt am Rohertrag (Mietausfallwagnis). Maßgeblich ist
  // dieselbe Sicht, aus der auch die Vorgaberendite kommt; fehlt sie, wird
  // auf die Vertragssicht zurückgegriffen, damit nicht eine fehlende
  // Sollstellung die gesamte Kostenseite verschweigt.
  const bezug = gestellt.wert ?? vertrag.wert;
  const kosten = bewirtschaftungskosten(s, b, bezug);

  const reinertrag = jahresreinertrag(gestellt, kosten);
  const reinertragVertrag = jahresreinertrag(vertrag, kosten);

  const kapital = eigenkapital(s, invest);
  const cashflow = cashflowJahr(reinertrag, s);

  // Rendite auf den heutigen Wert: derselbe Reinertrag, anderer Nenner.
  const wertAnsatz: Kennwert =
    s.verkehrswert === null
      ? ohne(
          "Für dieses Objekt ist kein Verkehrswert erfasst. Die Rendite " +
            "bezieht sich deshalb nur auf den Kaufpreis.",
          "Verkehrswert nicht erfasst.",
          "euro",
        )
      : s.verkehrswert <= 0
        ? ohne(
            `Der erfasste Verkehrswert ist ${EUR(s.verkehrswert)} €.`,
            `Verkehrswert ${EUR(s.verkehrswert)} €.`,
            "euro",
          )
        : wert(
            cent(s.verkehrswert),
            `Verkehrswert ${EUR(s.verkehrswert)} €.`,
            "euro",
          );

  return {
    gesamtinvest: invest,
    rohertragLautVertrag: vertrag,
    rohertragGestellt: gestellt,
    bewirtschaftung: kosten,
    jahresreinertrag: reinertrag,
    bruttomietrendite: bruttomietrendite(gestellt, invest),
    nettomietrendite: nettomietrendite(reinertrag, invest),
    nettomietrenditeLautVertrag: nettomietrendite(reinertragVertrag, invest),
    nettomietrenditeAufVerkehrswert: nettomietrendite(reinertrag, wertAnsatz),
    rohertragsfaktor: faktor(invest, gestellt, "Rohertrag"),
    reinertragsfaktor: faktor(invest, reinertrag, "Reinertrag"),
    eigenkapital: kapital,
    cashflowJahr: cashflow,
    eigenkapitalrendite: eigenkapitalrendite(cashflow, kapital),
    zinsdeckung: zinsdeckung(reinertrag, s),
    mieteJeQmMonat: mieteJeQmMonat(b),
    mietausfallquote: mietausfallquote(b),
    inkassoquote: inkassoquote(b),
  };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen für das Laden -- rein, damit sie geprüft werden können
// ---------------------------------------------------------------------------

/**
 * Ein `numeric` aus der Datenbank als Zahl, oder null.
 *
 * Der pg-Treiber liefert `numeric` als Text, damit keine Stellen verloren
 * gehen. Number("") ist 0 und Number(null) ist 0 -- genau die stille Null,
 * die diese Datei vermeiden soll. Deshalb eine eigene Funktion statt
 * Number() an elf Stellen.
 */
export function betragAusText(roh: string | number | null): number | null {
  if (roh === null || roh === undefined) return null;
  if (typeof roh === "number") return Number.isFinite(roh) ? roh : null;
  const text = roh.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Erster Tag eines Monats als ISO-Datum, in UTC. */
function ersterDesMonats(jahr: number, monat: number): string {
  // monat 0-basiert wie bei Date, darf über- und unterlaufen.
  const d = new Date(Date.UTC(jahr, monat, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Das Zwölfmonatsfenster: zwölf Monatsscheiben bis einschließlich heute.
 *
 * `von` einschließlich, `bis` ausschließlich -- so fällt kein Beleg vom
 * Monatsletzten heraus und keiner wird doppelt gezählt. Belege und
 * Sollstellungen benutzen DASSELBE Fenster; zwei verschieden lange Fenster
 * für Zähler und Nenner wären ein Fehler, der sich nicht ansehen lässt.
 *
 * `faelligBis` ist der Erste des laufenden Monats: Bis dahin sind Monate
 * abgeschlossen. Den laufenden Monat in die Zahlungsquoten zu nehmen hieße,
 * jede Miete, die am 5. noch nicht da ist, als Ausfall zu zählen.
 */
export function zwoelfMonatsFenster(heute: Date): {
  von: string;
  bis: string;
  faelligBis: string;
} {
  const jahr = heute.getUTCFullYear();
  const monat = heute.getUTCMonth();
  return {
    von: ersterDesMonats(jahr, monat - 11),
    bis: ersterDesMonats(jahr, monat + 1),
    faelligBis: ersterDesMonats(jahr, monat),
  };
}

/** Eine Einheit, soweit sie für die Flächengrundlage zählt. */
export interface FlaechenEinheit {
  id: string;
  eltern_id: string | null;
  flaeche_qm: string | number | null;
  /** Läuft auf dieser Einheit selbst ein Mietverhältnis? */
  hatVertrag: boolean;
}

/**
 * Fläche und Einheitenzahl hinter dem Monatssoll.
 *
 * Gezählt werden die Einheiten mit EIGENEM laufenden Mietverhältnis -- genau
 * die, die auch zum Monatssoll beitragen (lib/objekte.ts: mieteDerEinheit()
 * gibt ohne mv_id null). Eine WG-Etage mit einem Altmietverhältnis über die
 * ganze Etage hat oft selbst keine Fläche, ihre Zimmer darunter schon;
 * deshalb zählt für so eine Einheit die Summe der Kinderflächen. Ohne das
 * wäre die Fläche des 2. OG null und die Miete je m² unbrauchbar -- den
 * Fall beschreibt istBelegt() in lib/objekte.ts.
 */
export function flaechenGrundlage(einheiten: FlaechenEinheit[]): {
  flaeche: number;
  belegteEinheiten: number;
  belegteEinheitenMitFlaeche: number;
} {
  const kinderFlaeche = (elternId: string): number | null => {
    const kinder = einheiten.filter((k) => k.eltern_id === elternId);
    const werte = kinder
      .map((k) => betragAusText(k.flaeche_qm))
      .filter((w): w is number => w !== null);
    return werte.length > 0 ? summeCent(werte) : null;
  };

  let flaeche = 0;
  let belegteEinheiten = 0;
  let mitFlaeche = 0;

  for (const e of einheiten) {
    if (!e.hatVertrag) continue;
    belegteEinheiten++;
    const eigene = betragAusText(e.flaeche_qm);
    const gezaehlt = eigene ?? kinderFlaeche(e.id);
    if (gezaehlt !== null) {
      flaeche += gezaehlt;
      mitFlaeche++;
    }
  }

  return {
    flaeche: cent(flaeche),
    belegteEinheiten,
    belegteEinheitenMitFlaeche: mitFlaeche,
  };
}

// ===========================================================================
// Lesen aus der Datenbank
// ===========================================================================
//
// Ab hier wird nur abgefragt und an die Funktionen oben weitergegeben.
//
// MANDANTENTRENNUNG -- die wichtigste Zeile dieser Datei ist die, die hier
// NICHT steht: Es gibt kein mitMandant(). Der Mandant kommt allein aus dem
// Sitzungscookie, wie lib/db.ts ihn liest, und `objekt` traegt seit
// db/010_mandant.sql mandant_id, eine Policy mit USING und WITH CHECK sowie
// ENABLE und FORCE ROW LEVEL SECURITY. Die neuen Spalten aus db/030 erben
// diesen Schutz, weil sie an derselben Tabelle haengen; db/030 legt keine
// eigene Tabelle an (tests/rendite.test.ts haelt das fest).
//
// Jede Abfrage laeuft ueber tx() aus lib/db.ts. tx() setzt app.mandant per
// SET LOCAL fuer die Dauer der Transaktion und wirft KeinMandant, wenn
// keiner da ist -- query() tut beides ebenfalls, aber jeder query()-Aufruf
// ist eine eigene Transaktion. Hier liegen drei Aggregate in EINER: Sie
// sehen damit denselben Stand. Liefe der Nachtlauf fuer Sollstellungen
// zwischen zwei Abfragen durch, waere der Rohertrag sonst aus einem anderen
// Bestand gerechnet als die Zahlungsquoten.
//
// Weil ein Objekt eines fremden Mandanten null Zeilen liefert, rechnet diese
// Datei nie mit fremden Kaufpreisen oder Darlehen. Das ist der teuerste
// denkbare Fehler eines Mehrmandantenprodukts, und zwar der, der als
// richtige Zahl aussieht -- deshalb filtert hier auch nichts nach
// mandant_id von Hand: Was die Policy nicht hergibt, kommt gar nicht an.
//
// Jede Funktion hier nimmt eine objektId. Es gibt bewusst keine Abfrage
// ueber "alle Objekte" ohne diesen Weg; eine portfolioweite Summe entsteht,
// indem der Aufrufer je Objekt laedt, und sieht damit nur die Objekte des
// angemeldeten Mandanten.

/** Die Spalten aus db/030, in der Reihenfolge der Migration. */
const STAMM_SQL = `
    SELECT id, name,
           kaufpreis::text, kaufnebenkosten::text, kaufdatum::text,
           verkehrswert::text, bewirtschaftung_jahr::text,
           instandhaltung_je_qm::text, mietausfallwagnis_satz::text,
           darlehen_restschuld::text, darlehen_zins_satz::text,
           darlehen_rate_monat::text
      FROM objekt
     WHERE id = $1`;

interface StammZeile {
  id: string;
  name: string;
  kaufpreis: string | null;
  kaufnebenkosten: string | null;
  kaufdatum: string | null;
  verkehrswert: string | null;
  bewirtschaftung_jahr: string | null;
  instandhaltung_je_qm: string | null;
  mietausfallwagnis_satz: string | null;
  darlehen_restschuld: string | null;
  darlehen_zins_satz: string | null;
  darlehen_rate_monat: string | null;
}

/** Die Stammdaten eines Objekts, oder null -- auch bei fremdem Mandanten. */
export async function wirtschaftStamm(
  objektId: string,
): Promise<{ id: string; name: string; stamm: WirtschaftStamm } | null> {
  const z = await tx(async (c) => {
    const r = await c.query<StammZeile>(STAMM_SQL, [objektId]);
    return r.rows[0] ?? null;
  });
  if (!z) return null;
  return {
    id: z.id,
    name: z.name,
    stamm: {
      kaufpreis: betragAusText(z.kaufpreis),
      kaufnebenkosten: betragAusText(z.kaufnebenkosten),
      kaufdatum: z.kaufdatum,
      verkehrswert: betragAusText(z.verkehrswert),
      bewirtschaftung_jahr: betragAusText(z.bewirtschaftung_jahr),
      instandhaltung_je_qm: betragAusText(z.instandhaltung_je_qm),
      mietausfallwagnis_satz: betragAusText(z.mietausfallwagnis_satz),
      darlehen_restschuld: betragAusText(z.darlehen_restschuld),
      darlehen_zins_satz: betragAusText(z.darlehen_zins_satz),
      darlehen_rate_monat: betragAusText(z.darlehen_rate_monat),
    },
  };
}

/**
 * Die gemessene Basis eines Objekts.
 *
 * Das Monatssoll kommt aus objektKennzahlen() in lib/objekte.ts und wird
 * hier NICHT nachgerechnet. Dieselbe Regel wie dort: Zwei Rechnungen für
 * eine Zahl laufen auseinander, und beim Wort "Leerstand" ist das in dieser
 * Anwendung schon passiert.
 */
export async function wirtschaftBasis(
  objektId: string,
  heute: Date = new Date(),
): Promise<WirtschaftBasis> {
  const fenster = zwoelfMonatsFenster(heute);

  // einheitenDesObjekts() laeuft ueber query() und damit ueber eine eigene
  // Transaktion -- auch die setzt app.mandant per SET LOCAL und wirft ohne
  // Mandanten. Die Abfrage wird hier NICHT nachgebaut, um sie in dieselbe
  // Transaktion zu holen: Eine zweite Kopie von EINHEITEN_SQL waere eine
  // zweite Rechnung derselben Miete, und genau daran ist in dieser
  // Anwendung schon einmal das Wort "Leerstand" auseinandergelaufen.
  const einheiten: ObjektEinheit[] = await einheitenDesObjekts(objektId);
  const zahlen = objektKennzahlen(einheiten);
  const flaechen = flaechenGrundlage(
    einheiten.map((e) => ({
      id: e.id,
      eltern_id: e.eltern_id,
      flaeche_qm: e.flaeche_qm,
      hatVertrag: e.mv_id !== null,
    })),
  );

  // Drei Aggregate in EINER Transaktion: ein Mandant, ein Stand. Die
  // Begruendung steht im Abschnittskopf oben.
  const { soll, zahlung, belege } = await tx(async (c) => {
    const soll = await c.query<{ summe: string; monate: string }>(
      `SELECT COALESCE(SUM(s.betrag), 0)::text AS summe,
              COUNT(DISTINCT s.monat)::text    AS monate
         FROM sollstellung s
         JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
         JOIN einheit e          ON e.id  = mv.einheit_id
        WHERE e.objekt_id = $1
          AND s.monat >= $2::date
          AND s.monat <  $3::date`,
      [objektId, fenster.von, fenster.bis],
    );

    // Fälliges Soll und zugeordnetes Ist -- nur abgeschlossene Monate, und
    // nur ab objekt.zahlungsdaten_ab (db/023). Ist das Datum NULL, liefert
    // die Abfrage nichts, und die Quoten sagen "keine Kontodaten".
    const zahlung = await c.query<{
      soll: string;
      ist: string;
      monate: string;
    }>(
      `SELECT COALESCE(SUM(s.betrag), 0)::text   AS soll,
              COALESCE(SUM(z.ist), 0)::text      AS ist,
              COUNT(DISTINCT s.monat)::text      AS monate
         FROM sollstellung s
         JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
         JOIN einheit e          ON e.id  = mv.einheit_id
         JOIN objekt o           ON o.id  = e.objekt_id
         LEFT JOIN LATERAL (
               SELECT COALESCE(SUM(x.betrag), 0) AS ist
                 FROM zuordnung x
                WHERE x.sollstellung_id = s.id) z ON true
        WHERE e.objekt_id = $1
          AND s.monat >= $2::date
          AND s.monat <  $3::date
          AND o.zahlungsdaten_ab IS NOT NULL
          AND s.monat >= o.zahlungsdaten_ab`,
      [objektId, fenster.von, fenster.faelligBis],
    );

    const belege = await c.query<{
      summe: string;
      anzahl: string;
      finanzierung: string;
    }>(
      `SELECT COALESCE(SUM(betrag_brutto), 0)::text AS summe,
              COUNT(betrag_brutto)::text            AS anzahl,
              COUNT(betrag_brutto) FILTER (
                    WHERE kostenart = 'finanzierung')::text AS finanzierung
         FROM beleg
        WHERE objekt_id = $1
          AND richtung = 'eingang'
          AND belegdatum >= $2::date
          AND belegdatum <  $3::date`,
      [objektId, fenster.von, fenster.bis],
    );

    return {
      soll: soll.rows[0] ?? null,
      zahlung: zahlung.rows[0] ?? null,
      belege: belege.rows[0] ?? null,
    };
  });

  return {
    fensterVon: fenster.von,
    fensterBis: fenster.bis,
    sollMonat: zahlen.sollMonat,
    mietverhaeltnisse: einheiten.filter((e) => e.mv_id !== null).length,
    sollGestellt: betragAusText(soll?.summe ?? null) ?? 0,
    gestellteMonate: Number(soll?.monate ?? 0),
    belegkosten: betragAusText(belege?.summe ?? null) ?? 0,
    belege: Number(belege?.anzahl ?? 0),
    belegeFinanzierung: Number(belege?.finanzierung ?? 0),
    flaeche: flaechen.flaeche,
    belegteEinheiten: flaechen.belegteEinheiten,
    belegteEinheitenMitFlaeche: flaechen.belegteEinheitenMitFlaeche,
    sollFaellig: betragAusText(zahlung?.soll ?? null) ?? 0,
    istZugeordnet: betragAusText(zahlung?.ist ?? null) ?? 0,
    monateMitKontodaten: Number(zahlung?.monate ?? 0),
  };
}

export interface ObjektWirtschaftDaten {
  id: string;
  name: string;
  stamm: WirtschaftStamm;
  basis: WirtschaftBasis;
  lage: WirtschaftLage;
}

/**
 * Stammdaten, Basis und Lage eines Objekts -- das, was die Seite braucht.
 *
 * Gibt null zurück, wenn es das Objekt nicht gibt ODER es einem anderen
 * Mandanten gehört. Beides ist von aussen dieselbe Antwort; dass eine
 * fremde Akte existiert, ist selbst schon eine Auskunft.
 */
export async function objektWirtschaft(
  objektId: string,
  heute: Date = new Date(),
): Promise<ObjektWirtschaftDaten | null> {
  const kopf = await wirtschaftStamm(objektId);
  if (!kopf) return null;
  const basis = await wirtschaftBasis(objektId, heute);
  return {
    id: kopf.id,
    name: kopf.name,
    stamm: kopf.stamm,
    basis,
    lage: wirtschaftLage(kopf.stamm, basis),
  };
}
