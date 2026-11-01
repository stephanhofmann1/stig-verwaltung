import { query, tx } from "./db";

/**
 * Sollstellungen: welche Miete ist in welchem Monat fällig.
 *
 * Ohne sie hat der Kontoabgleich nichts, wogegen er prüfen könnte.
 * Erzeugt werden sie aus den Mietverhältnissen, rückwirkend ab Beginn
 * und bis zum laufenden Monat.
 *
 * Die Sollmiete besteht aus drei Posten: Kaltmiete, Nebenkosten und
 * Möblierungszuschlag. Fast alle WG-Zimmer sind möbliert vermietet; der
 * Zuschlag ist Teil der vereinbarten Miete und muss mitgestellt werden.
 * Fehlte er, bekäme jedes möblierte Mietverhältnis dauerhaft zu wenig Soll
 * gestellt — der Mieter zahlt den vollen Betrag, und der Kontoabgleich
 * meldet Monat für Monat eine Überzahlung, die es nicht gibt.
 *
 * Zwei Dinge, die in der Praxis vorkommen und hier berücksichtigt sind:
 *   - Ein- und Auszug mitten im Monat werden taggenau anteilig berechnet
 *     (§ 556b BGB rechnet nach Tagen des jeweiligen Monats).
 *   - Eine Mieterhöhung ist ein neues Mietverhältnis mit neuem Beginn,
 *     oder — einfacher — ein geänderter Betrag ab einem Stichtag. Darum
 *     werden bestehende Sollstellungen nie überschrieben: Was einmal
 *     gestellt und vielleicht schon bezahlt ist, bleibt stehen.
 */

export interface SollLauf {
  erzeugt: number;
  uebersprungen: number;
  bis_monat: string;
  /**
   * Mietverhältnisse, bei denen die im Vertrag zugesagte Gesamtmiete nicht
   * der Summe der Einzelposten entspricht. Gestellt wird die Zusage (siehe
   * sollGesamt); hier steht, wo beides auseinanderläuft.
   *
   * Das ist bewusst Teil des Ergebnisses und nicht nur eine Protokollzeile:
   * Eine Abweichung ist entweder ein Tippfehler in den Stammdaten oder eine
   * Mieterhöhung, die nur an einer Stelle nachgetragen wurde. Beides muss
   * jemand ansehen, und beides fällt sonst nie auf.
   */
  abweichungen: Mietabweichung[];
}

export interface Mietabweichung {
  mietverhaeltnis_id: string;
  kontakt_name: string;
  einheit: string;
  /** Der im Vertrag genannte Betrag. Dieser wird gestellt. */
  zugesagt: number;
  /** Kaltmiete + Nebenkosten + Möblierungszuschlag. */
  summe_posten: number;
}

interface Vertrag {
  id: string;
  beginn: string;
  ende: string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  /**
   * Möblierungszuschlag. Optional im Typ, weil die Abfrage die Spalte
   * defensiv liest: Solange die Migration noch nicht gelaufen ist, kommt
   * das Feld als null zurück (siehe Abfrage in erzeugeSollstellungen).
   */
  moeblierung?: string | null;
  /**
   * Die im Vertrag wörtlich zugesagte Gesamtmiete. Ebenfalls defensiv
   * gelesen. Ist sie gesetzt, hat sie Vorrang vor der Summe der Posten --
   * geschuldet ist, was im Vertrag steht.
   */
  gesamtmiete?: string | null;
  /**
   * Erster Monat, für den diese Plattform Soll stellt. Leer heißt: ab
   * beginn. Gesetzt bei übernommenen Altmietverhältnissen.
   */
  abrechnung_ab?: string | null;
  kontakt_name: string;
  einheit: string;
}

/** Macht aus Text, Zahl, null oder undefined eine brauchbare Zahl. */
function alsZahl(wert: string | number | null | undefined): number {
  if (wert === null || wert === undefined || wert === "") return 0;
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Die monatliche Gesamtmiete eines Mietverhältnisses.
 *
 * Steht im Vertrag ein Gesamtbetrag, gilt dieser -- auch wenn die Summe der
 * Einzelposten daneben liegt. Geschuldet ist, was zugesagt wurde; die
 * Aufteilung in Kalt-, Neben- und Möblierungsanteil ist die Herleitung, nicht
 * die Vereinbarung. Weicht beides voneinander ab, wird das gemeldet
 * (SollLauf.abweichungen) statt stillschweigend korrigiert.
 *
 * Ohne Vertragsbetrag: Kaltmiete + Nebenkosten + Möblierungszuschlag.
 * Ein fehlender Posten
 * (NULL in der Datenbank, oder die Spalte gibt es noch nicht) zählt als 0 —
 * er darf die Rechnung nicht auf NaN kippen, denn daraus würde eine
 * Sollstellung von null statt einer Fehlermeldung.
 *
 * Am Ende auf Cent gerundet: Die Posten kommen als Text aus numeric(10,2),
 * und die Addition als Fließkommazahl erzeugt sonst Reste wie 599.9999999.
 */
export function sollGesamt(v: {
  kaltmiete: string | number | null;
  nebenkosten: string | number | null;
  moeblierung?: string | number | null;
  gesamtmiete?: string | number | null;
}): number {
  const zugesagt = alsZahl(v.gesamtmiete);
  if (zugesagt > 0) return Math.round(zugesagt * 100) / 100;
  return summePosten(v);
}

/** Kaltmiete + Nebenkosten + Möblierungszuschlag, ohne die Vertragszusage. */
export function summePosten(v: {
  kaltmiete: string | number | null;
  nebenkosten: string | number | null;
  moeblierung?: string | number | null;
}): number {
  const summe =
    alsZahl(v.kaltmiete) + alsZahl(v.nebenkosten) + alsZahl(v.moeblierung);
  return Math.round(summe * 100) / 100;
}

/** Eine Mietanpassung, wie db/022 sie fuehrt. */
export interface Anpassung {
  mietverhaeltnis_id: string;
  gilt_ab: string;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierung: string | null;
  gesamtmiete: string | null;
  grund: string;
}

/**
 * Der Betrag, der am ersten Tag des Monats galt.
 *
 * Maßgeblich ist der Monatserste, nicht das Monatsende: Eine Erhöhung, die
 * am 15. wirksam wird, gilt erst ab dem Folgemonat. Sonst bekäme der halbe
 * Monat davor rückwirkend den höheren Betrag. Mieterhöhungen nach § 558 BGB
 * werden ohnehin zum Monatsersten wirksam; fällt eine Anpassung doch mitten
 * in den Monat, meldet der Lauf das als Hinweis, statt still zu rechnen.
 */
export function betragImMonat(
  monat: Date,
  anpassungen: Anpassung[],
  vertrag: Vertrag,
): { gesamt: number; posten: number; quelle: string } {
  const erster = monat.toISOString().slice(0, 10);
  const gueltig = anpassungen
    .filter((a) => a.gilt_ab <= erster)
    .sort((a, b) => (a.gilt_ab < b.gilt_ab ? 1 : -1))[0];

  if (!gueltig) {
    // Keine Historie für diesen Zeitpunkt: die Werte am Mietverhältnis.
    // So verhält sich alles ohne Anpassungen genau wie vorher.
    return {
      gesamt: sollGesamt(vertrag),
      posten: summePosten(vertrag),
      quelle: "Mietverhältnis",
    };
  }
  const w = {
    kaltmiete: gueltig.kaltmiete,
    nebenkosten: gueltig.nebenkosten,
    moeblierung: gueltig.moeblierung,
    gesamtmiete: gueltig.gesamtmiete,
  };
  return {
    gesamt: sollGesamt(w),
    posten: summePosten(w),
    quelle: `Anpassung ab ${gueltig.gilt_ab} (${gueltig.grund})`,
  };
}

/** Tage im Monat, den dieses Datum trifft. */
function tageImMonat(jahr: number, monat1bis12: number): number {
  return new Date(Date.UTC(jahr, monat1bis12, 0)).getUTCDate();
}

/**
 * Betrag für einen Monat. Voller Monat, außer der Mieter zieht mittendrin
 * ein oder aus — dann anteilig nach Tagen.
 */
export function monatsbetrag(
  monatErster: Date,
  beginn: Date,
  ende: Date | null,
  gesamt: number,
): { betrag: number; anteilig: boolean; tage: number; vonTagen: number } {
  const jahr = monatErster.getUTCFullYear();
  const monat = monatErster.getUTCMonth() + 1;
  const tage = tageImMonat(jahr, monat);
  const letzter = new Date(Date.UTC(jahr, monat - 1, tage));

  const von = beginn > monatErster ? beginn : monatErster;
  const bis = ende && ende < letzter ? ende : letzter;

  if (bis < von) return { betrag: 0, anteilig: true, tage: 0, vonTagen: tage };

  const belegt =
    Math.round((bis.getTime() - von.getTime()) / 86_400_000) + 1;

  if (belegt >= tage) {
    return { betrag: gesamt, anteilig: false, tage, vonTagen: tage };
  }
  return {
    betrag: Math.round((gesamt * belegt) / tage * 100) / 100,
    anteilig: true,
    tage: belegt,
    vonTagen: tage,
  };
}

/**
 * Erzeugt fehlende Sollstellungen bis einschließlich des angegebenen
 * Monats (voreingestellt: der laufende). Vorhandene bleiben unberührt.
 */
export async function erzeugeSollstellungen(
  bisMonat?: string,
): Promise<SollLauf> {
  const jetzt = new Date();
  const grenze = bisMonat
    ? new Date(bisMonat + "T00:00:00Z")
    : new Date(
        Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), 1),
      );

  const vertraege = await query<Vertrag>(`
    SELECT mv.id, mv.beginn::text, mv.ende::text, mv.kaltmiete::text,
           mv.nebenkosten::text,
           -- Möblierungszuschlag absichtlich NICHT als
           -- mv.moeblierungszuschlag.
           --
           -- Die Spalte (moeblierungszuschlag numeric(10,2) auf
           -- mietverhaeltnis, Migration 017) wird gerade erst angelegt. Ein
           -- direkter Spaltenzugriff wäre ein Parse-Fehler ("column
           -- mv.moeblierungszuschlag does not exist") und würde jeden
           -- Sollstellungslauf hart abbrechen, solange die Migration nicht
           -- durch ist — also genau in dem Zeitfenster, in dem beide Stände
           -- parallel existieren.
           --
           -- to_jsonb(mv) baut die Zeile als JSON-Objekt aus den Spalten, die
           -- es tatsächlich gibt. ->> 'moeblierungszuschlag' ist dann ein
           -- Schlüsselzugriff und kein Spaltenname: fehlt der Schlüssel,
           -- kommt NULL zurück, und NULL behandelt sollGesamt als 0. Sobald
           -- die Spalte existiert, liefert derselbe Ausdruck ihren Wert als
           -- Text -- dasselbe Format wie die ::text-Felder daneben.
           --
           -- Der Schlüssel MUSS wörtlich so heißen wie die Spalte. Ein
           -- Tippfehler fällt hier nicht auf: Er wirft keinen Fehler,
           -- sondern liefert still NULL -- und damit dauerhaft zu niedrige
           -- Sollstellungen. Genau das war hier zuerst der Fall ('moeblierung'
           -- statt 'moeblierungszuschlag'). Deshalb prüft
           -- tests/schema.test.ts, dass dieser Schlüssel und der Spaltenname
           -- in db/017_altdaten.sql übereinstimmen.
           (to_jsonb(mv) ->> 'moeblierungszuschlag') AS moeblierung,
           -- Ebenfalls aus Migration 017, ebenfalls defensiv gelesen.
           (to_jsonb(mv) ->> 'gesamtmiete') AS gesamtmiete,
           (to_jsonb(mv) ->> 'abrechnung_ab') AS abrechnung_ab,
           k.anzeigename AS kontakt_name,
           e.bezeichnung AS einheit
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
       -- Ein Mietverhältnis ist abrechenbar, wenn es einen Betrag gibt --
       -- egal welchen. Vorher stand hier nur "kaltmiete IS NOT NULL", und
       -- damit fiel jede All-inclusive-Miete heraus: Die WG-Zimmer sind
       -- überwiegend so vermietet ("500 EUR all-in, keine Nebenkosten"),
       -- haben also gar keine getrennte Kaltmiete. Beim Import der echten
       -- Daten hätten 22 von 37 Mietverhältnissen keine Sollstellung
       -- bekommen -- lautlos, weil ein fehlender Eintrag genauso aussieht
       -- wie ein Monat ohne Forderung.
     WHERE (mv.kaltmiete IS NOT NULL
            OR (to_jsonb(mv) ->> 'gesamtmiete') IS NOT NULL)
       -- Ein verschickter, aber nicht unterschriebener Vertrag ist keine
       -- Mietforderung. Ohne diese Bedingung bekäme ein Mietverhältnis mit
       -- status='vertrag_versendet' ab seinem Beginn Sollstellungen, der
       -- Kontoabgleich würde sie anmahnen, und das Mahnwesen schriebe
       -- jemanden an, der nie eingezogen ist.
       --
       -- COALESCE, weil die Spalte erst mit 017 entsteht: Vor der Migration
       -- liefert der Ausdruck NULL, und dann soll wie bisher alles
       -- berücksichtigt werden -- nicht nichts.
       AND COALESCE(to_jsonb(mv) ->> 'status', 'aktiv')
           IN ('aktiv','gekuendigt','beendet')
     ORDER BY mv.beginn
  `);

  // Die Mietanpassungen in EINER Abfrage, nicht je Monat eine. Bei drei
  // Jahren Rückwirkung und 38 Mietverhältnissen wären das sonst über
  // tausend Rundreisen zur Datenbank.
  //
  // Defensiv gelesen: Die Tabelle entsteht erst mit Migration 022. Fehlt
  // sie, läuft die Sollstellung wie bisher mit dem Betrag am
  // Mietverhältnis -- ein abgebrochener Lauf wäre schlimmer als einer ohne
  // Historie.
  let anpassungen: Anpassung[] = [];
  try {
    anpassungen = await query<Anpassung>(`
      SELECT mietverhaeltnis_id, gilt_ab::text,
             kaltmiete::text, nebenkosten::text,
             moeblierungszuschlag::text AS moeblierung,
             gesamtmiete::text, grund
        FROM mietanpassung
       ORDER BY mietverhaeltnis_id, gilt_ab
    `);
  } catch {
    anpassungen = [];
  }
  const nachVertrag = new Map<string, Anpassung[]>();
  for (const a of anpassungen) {
    const liste = nachVertrag.get(a.mietverhaeltnis_id) ?? [];
    liste.push(a);
    nachVertrag.set(a.mietverhaeltnis_id, liste);
  }

  let erzeugt = 0;
  let uebersprungen = 0;
  const abweichungen: Mietabweichung[] = [];

  await tx(async (c) => {
    for (const v of vertraege) {
      const meine = nachVertrag.get(v.id) ?? [];
      // Nur zur Vorabprüfung, ob überhaupt etwas zu stellen ist.
      const gesamt = sollGesamt(v);
      if (gesamt <= 0 && meine.length === 0) continue;

      // Zusage und Herleitung vergleichen, solange beides vorliegt. Ein
      // Cent Unterschied ist bereits einer: numeric(10,2) rundet nicht, und
      // die Posten kommen beide aus derselben Spaltenbreite.
      const posten = summePosten(v);
      if (alsZahl(v.gesamtmiete) > 0 && posten > 0 && posten !== gesamt) {
        abweichungen.push({
          mietverhaeltnis_id: v.id,
          kontakt_name: v.kontakt_name,
          einheit: v.einheit,
          zugesagt: gesamt,
          summe_posten: posten,
        });
      }

      const beginn = new Date(v.beginn + "T00:00:00Z");
      const ende = v.ende ? new Date(v.ende + "T00:00:00Z") : null;

      // Ab wann diese Plattform abrechnet. Ohne Angabe ab Mietbeginn --
      // richtig für alles, was hier entsteht.
      //
      // Für übernommene Altmietverhältnisse ist es falsch: Beim Import am
      // 01.11.2026 hätte der Lauf für eine Mieterin seit Juli 2007 rund
      // 232 Monatsforderungen angelegt, denen keine Zahlung gegenübersteht.
      // Der Kontoabgleich hätte daraus einen Rückstand gemacht und das
      // Mahnwesen eine Mahnung an jemanden, der seit achtzehn Jahren
      // pünktlich zahlt.
      const abDatum = v.abrechnung_ab
        ? new Date(v.abrechnung_ab + "T00:00:00Z")
        : beginn;
      const ab = abDatum > beginn ? abDatum : beginn;

      const lauf = new Date(
        Date.UTC(ab.getUTCFullYear(), ab.getUTCMonth(), 1),
      );

      while (lauf <= grenze) {
        if (ende && lauf > ende) break;

        // Für die anteilige Berechnung gilt der spätere der beiden Tage:
        // Wer am 15. übernommen wurde, schuldet dieser Plattform den Monat
        // nicht von Anfang an.
        // Der Betrag, der in DIESEM Monat galt -- nicht der heutige.
        const { gesamt: monatsGesamt } = betragImMonat(lauf, meine, v);

        const { betrag, anteilig, tage, vonTagen } = monatsbetrag(
          lauf,
          ab,
          ende,
          monatsGesamt,
        );

        if (betrag > 0) {
          const monatIso = lauf.toISOString().slice(0, 10);
          const r = await c.query(
            `INSERT INTO sollstellung (mietverhaeltnis_id, monat, betrag, notizen)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (mietverhaeltnis_id, monat) DO NOTHING
             RETURNING id`,
            [
              v.id,
              monatIso,
              betrag,
              anteilig
                ? `Anteilig: ${tage} von ${vonTagen} Tagen.`
                : null,
            ],
          );
          if (r.rowCount && r.rowCount > 0) erzeugt++;
          else uebersprungen++;
        }

        lauf.setUTCMonth(lauf.getUTCMonth() + 1);
      }
    }
  });

  return {
    erzeugt,
    uebersprungen,
    bis_monat: grenze.toISOString().slice(0, 10),
    abweichungen,
  };
}
