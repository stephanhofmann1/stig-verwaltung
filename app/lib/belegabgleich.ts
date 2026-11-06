import { query, tx } from "./db";
import { vergleichbar } from "./zuordnung";
import { stehtDrin } from "./referenzen";

/**
 * Ordnet Abbuchungen den passenden Belegen zu.
 *
 * Reihenfolge der Sicherheit:
 *   0. Eine Referenz des Belegs steht im Zweck    → sicher
 *   1. Belegnummer steht im Verwendungszweck      → sicher
 *   2. Aussteller erkannt und Betrag passt genau  → sicher
 *   3. nur der Betrag passt, genau ein Kandidat   → unsicher
 *   4. alles andere                               → bleibt offen
 *
 * Nichts wird stillschweigend gebucht. Was unsicher ist, landet in der
 * Lückenliste — eine falsche Zuordnung fällt in der Steuererklärung
 * später niemandem mehr auf, und genau das wollen wir vermeiden.
 */

export interface OffeneAusgabe {
  id: string;
  buchungstag: string;
  betrag: string;
  absender: string | null;
  verwendungszweck: string | null;
}

export interface BelegKandidat {
  id: string;
  belegnummer: string | null;
  betrag_brutto: string | null;
  belegdatum: string | null;
  dateiname: string | null;
  aussteller: string | null;
  kontakt_name: string | null;
  vorgang_referenz: string | null;
  offen: string;
}

export interface BelegVorschlag {
  buchung_id: string;
  beleg_id: string | null;
  betrag: number;
  sicherheit: "sicher" | "unsicher";
  begruendung: string;
  beleg_bezeichnung?: string;
  /**
   * Weitere Belege zu DERSELBEN Abbuchung.
   *
   * Eine Amazon-Bestellung kann in mehreren Lieferungen kommen, und jede
   * traegt ihre eigene Rechnung -- abgebucht wird trotzdem einmal, unter
   * der gemeinsamen Bestellnummer. Ein Vorschlag je Abbuchung bliebe
   * dann unvollstaendig, und die Bewegung staende weiter als "teilweise
   * belegt" da.
   *
   * Die Oberflaeche zeigt weiterhin einen Eintrag je Bewegung; beim
   * Festschreiben werden alle gebucht.
   */
  weitere?: Array<{ beleg_id: string; betrag: number }>;
}

/** Abbuchungen ohne (vollständigen) Beleg. */
export async function offeneAusgaben(): Promise<OffeneAusgabe[]> {
  return query<OffeneAusgabe>(`
    SELECT b.id, b.buchungstag::text, b.betrag::text, b.absender,
           b.verwendungszweck
      FROM buchung b
     WHERE b.betrag < 0
       AND b.beleg_nicht_noetig = false
       AND abs(b.betrag) > COALESCE(
             (SELECT sum(bb.betrag) FROM belegbuchung bb
               WHERE bb.buchung_id = b.id), 0)
     ORDER BY b.buchungstag DESC
  `);
}

/** Belege, die noch nicht vollständig durch Zahlungen gedeckt sind. */
export async function offeneBelege(): Promise<BelegKandidat[]> {
  return query<BelegKandidat>(`
    SELECT bg.id, bg.belegnummer, bg.betrag_brutto::text, bg.belegdatum::text,
           bg.dateiname, bg.aussteller,
           k.anzeigename AS kontakt_name, v.referenz AS vorgang_referenz,
           (COALESCE(bg.betrag_brutto,0) - COALESCE(
              (SELECT sum(bb.betrag) FROM belegbuchung bb
                WHERE bb.beleg_id = bg.id), 0))::text AS offen
      FROM beleg bg
      LEFT JOIN kontakt k ON k.id = bg.kontakt_id
      LEFT JOIN vorgang v ON v.id = bg.vorgang_id
     WHERE bg.richtung = 'eingang'
       -- Belege, bei denen die beiden Auswertungen sich über Betrag oder
       -- Datum nicht einig waren (db/033, api/belege/einlieferung), bleiben
       -- hier aussen vor. Sonst würde der selbsttätige Abgleich genau die
       -- Zeilen festschreiben, deren Zahlen zweifelhaft sind -- und ein
       -- bestätigter falscher Treffer ist schlimmer als keiner: Er sieht
       -- wie Arbeit aus, die erledigt ist.
       AND bg.abweichung IS NULL
     ORDER BY bg.belegdatum DESC NULLS LAST
  `);
}

/**
 * Die normierten Referenzen je Beleg.
 *
 * Einmal geladen und als Karte gehalten: Der Abgleich vergleicht jede
 * Abbuchung gegen jeden Beleg, und eine Abfrage je Paar waere bei 500
 * Bewegungen und 230 Belegen 115.000 Abfragen.
 */
async function referenzenJeBeleg(): Promise<Map<string, string[]>> {
  const zeilen = await query<{ beleg_id: string; normiert: string }>(
    `SELECT beleg_id, normiert FROM beleg_referenz`,
  );
  const karte = new Map<string, string[]>();
  for (const z of zeilen) {
    const vorhanden = karte.get(z.beleg_id);
    if (vorhanden) vorhanden.push(z.normiert);
    else karte.set(z.beleg_id, [z.normiert]);
  }
  return karte;
}

function bezeichne(b: BelegKandidat): string {
  const teile = [
    b.aussteller ?? b.kontakt_name ?? "Unbekannt",
    b.belegnummer ?? b.dateiname ?? "ohne Nummer",
  ];
  return teile.join(" · ");
}

/**
 * Woerter, die keinen Aussteller kennzeichnen.
 *
 * Die Namenspruefung nahm jedes Wort ab vier Zeichen. "GmbH" hat vier.
 * Damit passte jede GmbH zu jeder GmbH -- und wenn dann noch der Betrag
 * stimmte, galt das als "Aussteller erkannt und Betrag stimmt auf den
 * Cent". Bei zwei Rechnungen ueber denselben Betrag von zwei
 * verschiedenen Firmen waere das eine falsche Zuordnung mit dem
 * Guetesiegel "sicher".
 *
 * Rechtsformen und Allerweltszusaetze zaehlen deshalb nicht als Kennung.
 */
const BEDEUTUNGSLOS = new Set([
  // Kurze Rechtsformen zaehlen hier mit, obwohl sie die Vier-Zeichen-
  // Huerde ohnehin nicht nehmen: Sie duerfen auch nicht als halbes Paar
  // durchgehen. "Alpha GmbH & Co. KG" und "Beta GmbH & Co. KG" haben
  // beide die Folge "co kg" -- ohne diese Eintraege waere das ein
  // Treffer zwischen zwei fremden Firmen.
  "ag", "se", "ug", "eg", "ev", "kg", "co", "sa", "as", "ab", "oy",
  "plc", "llc", "lp", "aps",
  "gmbh", "mbh", "ohg", "kgaa", "gbr", "egbr", "ltd", "limited", "inc",
  "corp", "sarl", "scrl", "sca", "nv", "bv", "sprl", "spa", "srl",
  "haftungsbeschraenkt", "haftungsbeschrankt", "unternehmergesellschaft",
  "deutschland", "germany", "europe", "european", "international",
  "holding", "gruppe", "group", "company", "verwaltung", "service",
  "services", "online", "payments", "payment",
]);

/**
 * Traegt der Beleg den Namen, der in der Abbuchung steht?
 *
 * Zwei Wege, und der zweite ist der eigentliche Gewinn:
 *
 *   a) Ein kennzeichnendes Wort ab vier Zeichen steht in beiden.
 *   b) Zwei aufeinanderfolgende Woerter des Belegnamens stehen in
 *      derselben Reihenfolge in der Abbuchung.
 *
 * (b) faengt die Faelle, die (a) nicht kann: "SMP GmbH & Co. KG" hat
 * kein kennzeichnendes Wort ab vier Zeichen -- "smp" sind drei, "gmbh"
 * und "co" und "kg" sagen nichts. Die Folge "smp gmbh" dagegen steht so
 * im Verwendungszweck und ist eindeutig. Zwei Woerter in Reihe sind ein
 * staerkeres Zeugnis als ein einzelnes kurzes.
 */
export function nameStecktDrin(belegName: string, zweck: string): boolean {
  const name = vergleichbar(belegName);
  const text = vergleichbar(zweck);
  if (!name || !text) return false;

  const woerter = name.split(" ").filter(Boolean);

  // a) ein kennzeichnendes Wort
  if (
    woerter.some(
      (w) => w.length >= 4 && !BEDEUTUNGSLOS.has(w) && text.includes(w),
    )
  ) {
    return true;
  }

  // b) zwei Woerter in Reihe -- aber nicht zwei bedeutungslose
  // ("gmbh co" stuende sonst in jeder zweiten Abbuchung).
  for (let i = 0; i + 1 < woerter.length; i += 1) {
    const paar = `${woerter[i]} ${woerter[i + 1]}`;
    if (BEDEUTUNGSLOS.has(woerter[i]) && BEDEUTUNGSLOS.has(woerter[i + 1])) {
      continue;
    }
    if (text.includes(paar)) return true;
  }
  return false;
}

/** Tage zwischen zwei Tagesangaben, positiv wenn b nach a liegt. */
function tageZwischen(a: string, b: string): number | null {
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round((y - x) / 86_400_000);
}

/**
 * Das Fenster, in dem eine Abbuchung zu einem Beleg gehoeren kann.
 *
 * Bezahlt wird nach dem Rechnungsdatum, nicht davor -- aber eine
 * Abbuchung kann einen Tag vor dem gedruckten Rechnungsdatum im Auszug
 * stehen, etwa bei einem Abonnement, das am Monatsersten bucht und die
 * Rechnung auf den Zweiten datiert. Zwei Tage Vorlauf sind deshalb
 * erlaubt, 45 Tage Nachlauf.
 */
const VORLAUF_TAGE = 2;
const NACHLAUF_TAGE = 45;

/**
 * Der Abstand, den der zweitbeste Beleg haben muss.
 *
 * Ohne diese Huerde waere "der naechstliegende gewinnt" ein Muenzwurf,
 * sobald zwei Belege dicht beieinander liegen. Fuenf Tage trennen ein
 * Monatsabonnement sicher (die Nachbarn liegen 30 Tage weg) und
 * verweigern die Entscheidung dort, wo zwei gleiche Betraege in
 * derselben Woche gezahlt wurden.
 */
const MINDESTABSTAND_TAGE = 5;

/**
 * Unter gleich teuren Belegen den einen waehlen, den das Datum ausweist.
 *
 * WOFUER
 *
 * Am 06.11.2026 lagen neun WG-Gesucht-Rechnungen ueber je 41,53 EUR
 * neben neun Abbuchungen ueber je 41,53 EUR. Der Betrag entscheidet
 * nichts, der Name steht in jeder der neun Abbuchungen gleich -- nur das
 * Datum unterscheidet sie: Rechnung vom 12.09., Abbuchung ein paar Tage
 * spaeter.
 *
 * WANN SIE SCHWEIGT
 *
 * Wenn kein Beleg im Fenster liegt, wenn dem naechsten ein zweiter zu
 * dicht folgt, oder wenn der Abbuchung selbst das Datum fehlt. Dann
 * bleibt die Zuordnung offen -- ein Muenzwurf, der als Zuordnung
 * festgeschrieben wird, sieht hinterher aus wie erledigte Arbeit.
 */
export function waehleNachDatum(
  kandidaten: BelegKandidat[],
  buchungsdatum: string | null,
): { beleg: BelegKandidat; tage: number } | null {
  if (!buchungsdatum) return null;
  const mitDatum = kandidaten
    .filter((b) => b.belegdatum)
    .map((b) => ({ beleg: b, tage: tageZwischen(b.belegdatum!, buchungsdatum) }))
    .filter(
      (x): x is { beleg: BelegKandidat; tage: number } =>
        x.tage !== null && x.tage >= -VORLAUF_TAGE && x.tage <= NACHLAUF_TAGE,
    )
    .sort((p, q) => Math.abs(p.tage) - Math.abs(q.tage));

  if (mitDatum.length === 0) return null;
  if (mitDatum.length === 1) return mitDatum[0];
  const abstand = Math.abs(mitDatum[1].tage) - Math.abs(mitDatum[0].tage);
  return abstand >= MINDESTABSTAND_TAGE ? mitDatum[0] : null;
}

export async function schlageBelegeVor(): Promise<BelegVorschlag[]> {
  const ausgaben = await offeneAusgaben();
  const belege = await offeneBelege();
  const referenzen = await referenzenJeBeleg();
  const vorschlaege: BelegVorschlag[] = [];

  for (const a of ausgaben) {
    const betrag = Math.abs(Number(a.betrag));
    const text = vergleichbar(`${a.absender ?? ""} ${a.verwendungszweck ?? ""}`);
    const rohText = `${a.absender ?? ""} ${a.verwendungszweck ?? ""}`.toUpperCase();
    const normierterZweck = `${a.absender ?? ""} ${a.verwendungszweck ?? ""}`;

    // 0. Eine Referenz des Belegs steht im Verwendungszweck.
    //
    // Das ist der verlaesslichste Treffer, den es gibt: Die Nummer hat
    // der Zahlungsempfaenger vergeben, sie steht auf dem Beleg und sie
    // steht in der Abbuchung. Bei Amazon ist das die Bestellnummer
    // ("304-2954807-8841912 Amazon.de ..."), bei Versorgern die
    // Kundennummer, bei der Stadtkasse das Kassenzeichen.
    //
    // Vorher suchte nur Regel 1 nach der BELEGNUMMER -- und die steht in
    // einer Amazon-Abbuchung nie. 162 Abbuchungen und 211 Rechnungen
    // lagen deshalb am 05.11.2026 nebeneinander, ohne einen Treffer.
    const perReferenz = belege.filter(
      (b) =>
        Number(b.offen) > 0.005 &&
        (referenzen.get(b.id) ?? []).some((r) => stehtDrin(r, normierterZweck)),
    );
    if (perReferenz.length === 1) {
      const b = perReferenz[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag: Math.min(betrag, Number(b.offen)),
        sicherheit: "sicher",
        begruendung: "Referenznummer des Belegs steht im Verwendungszweck.",
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }
    if (perReferenz.length > 1) {
      // Mehrere Belege tragen dieselbe Referenz -- eine Bestellung, in
      // Teillieferungen berechnet. Nur wenn ihre offenen Betraege
      // zusammen genau die Abbuchung ergeben, ist das eindeutig.
      const summe = perReferenz.reduce((s, b) => s + Number(b.offen), 0);
      if (Math.abs(summe - betrag) < 0.005) {
        const [erster, ...rest] = perReferenz;
        vorschlaege.push({
          buchung_id: a.id,
          beleg_id: erster.id,
          betrag: Number(erster.offen),
          sicherheit: "sicher",
          begruendung:
            `${perReferenz.length} Belege mit derselben Referenz, zusammen genau ` +
            "der Betrag der Abbuchung (Teillieferungen einer Bestellung).",
          beleg_bezeichnung: bezeichne(erster),
          weitere: rest.map((b) => ({ beleg_id: b.id, betrag: Number(b.offen) })),
        });
        continue;
      }
    }

    // 1. Belegnummer im Verwendungszweck
    const perNummer = belege.filter(
      (b) =>
        b.belegnummer &&
        Number(b.offen) > 0.005 &&
        rohText.replace(/[\s\-\/]/g, "").includes(
          b.belegnummer.replace(/[\s\-\/]/g, ""),
        ),
    );
    if (perNummer.length === 1) {
      const b = perNummer[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag: Math.min(betrag, Number(b.offen)),
        sicherheit: "sicher",
        begruendung: `Belegnummer ${b.belegnummer} steht im Verwendungszweck.`,
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }

    // 2. Aussteller erkannt und Betrag stimmt
    const perName = belege.filter(
      (b) =>
        Number(b.offen) > 0.005 &&
        nameStecktDrin(b.aussteller ?? b.kontakt_name ?? "", normierterZweck),
    );
    const nameUndBetrag = perName.filter(
      (b) => Math.abs(Number(b.offen) - betrag) < 0.005,
    );
    if (nameUndBetrag.length === 1) {
      const b = nameUndBetrag[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag,
        sicherheit: "sicher",
        begruendung: "Aussteller erkannt und Betrag stimmt auf den Cent.",
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }

    // 2a. Derselbe Aussteller, derselbe Betrag, mehrere Belege -- dann
    // entscheidet das Datum.
    //
    // Der Fall, der das noetig machte: neun WG-Gesucht-Rechnungen ueber
    // je 41,53 EUR neben neun Abbuchungen ueber je 41,53 EUR. Betrag und
    // Name sind bei allen neun gleich; nur das Datum unterscheidet sie.
    if (nameUndBetrag.length > 1) {
      const gewaehlt = waehleNachDatum(nameUndBetrag, a.buchungstag);
      if (gewaehlt) {
        vorschlaege.push({
          buchung_id: a.id,
          beleg_id: gewaehlt.beleg.id,
          betrag,
          sicherheit: "sicher",
          begruendung:
            `Aussteller und Betrag stimmen bei ${nameUndBetrag.length} Belegen; ` +
            `dieser liegt ${gewaehlt.tage} Tage vor der Abbuchung und damit ` +
            "deutlich näher als der nächstbeste.",
          beleg_bezeichnung: bezeichne(gewaehlt.beleg),
        });
        continue;
      }
    }

    // 3. nur der Betrag
    const nurBetrag = belege.filter(
      (b) => Math.abs(Number(b.offen) - betrag) < 0.005,
    );
    if (nurBetrag.length === 1) {
      const b = nurBetrag[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag,
        sicherheit: "unsicher",
        begruendung:
          "Nur der Betrag passt. Aussteller und Belegnummer stimmen nicht überein — bitte prüfen.",
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }

    // 3a. Mehrere Belege mit dem Betrag, aber nur einer passt zeitlich.
    //
    // Hier fehlt der Name, also bleibt es ein Vorschlag und wird nicht
    // festgeschrieben: uebernehmeSichereBelege() nimmt nur "sicher".
    // Betrag und Datum allein sagen nichts darueber, WER das Geld
    // bekommen hat -- das muss ein Mensch ansehen.
    if (nurBetrag.length > 1) {
      const gewaehlt = waehleNachDatum(nurBetrag, a.buchungstag);
      if (gewaehlt) {
        vorschlaege.push({
          buchung_id: a.id,
          beleg_id: gewaehlt.beleg.id,
          betrag,
          sicherheit: "unsicher",
          begruendung:
            `${nurBetrag.length} Belege mit diesem Betrag. Dieser liegt ` +
            `${gewaehlt.tage} Tage vor der Abbuchung und damit am nächsten — ` +
            "der Aussteller ist aber nicht bestätigt, bitte prüfen.",
          beleg_bezeichnung: bezeichne(gewaehlt.beleg),
        });
        continue;
      }
    }

    vorschlaege.push({
      buchung_id: a.id,
      beleg_id: null,
      betrag,
      sicherheit: "unsicher",
      begruendung:
        nurBetrag.length > 1
          ? `${nurBetrag.length} Belege mit diesem Betrag — nicht eindeutig, ` +
            "und auch das Datum entscheidet es nicht."
          : "Kein passender Beleg vorhanden.",
    });
  }

  // Zum Schluss: Kein Beleg darf zwei Abbuchungen belegen.
  return entwirreMehrfachnutzung(
    vorschlaege,
    new Map(ausgaben.map((a) => [a.id, a.buchungstag])),
    new Map(belege.map((b) => [b.id, b.belegdatum])),
  );
}

/** Schreibt die sicheren Treffer fest. */
/**
 * Einen Beleg nur einmal festschreiben.
 *
 * WOFUER
 *
 * Der Abgleich laeuft ueber die Abbuchungen und sucht je Abbuchung den
 * passenden Beleg. Die Liste der offenen Belege wird dabei EINMAL
 * geladen; das Feld `offen` darin ist ein Stand von vorher. Innerhalb
 * eines Laufs sinkt es nicht mit. Also konnte derselbe Beleg mehreren
 * Abbuchungen als "sicher" zugeschlagen werden.
 *
 * Am 06.11.2026 war das kein Gedankenspiel: Ein Zahlungsnachweis ueber
 * 16,99 EUR hing an VIER Abbuchungen von je 16,99 EUR, drei davon am
 * selben Tag. Vier Zahlungen, ein Beleg -- in den Buechern sah es aus
 * wie vier belegte Ausgaben. Ueber Laufgrenzen hinweg war der Fall
 * abgedeckt (`offeneBelege` zieht die schon gebuchten Betraege ab);
 * innerhalb eines Laufs nicht.
 *
 * WIE ENTSCHIEDEN WIRD
 *
 * Nicht "wer zuerst kommt". Die Reihenfolge der Abbuchungen ist
 * willkuerlich, und ein Wuerfelwurf waere hier schlimmer als eine
 * offene Frage. Es gewinnt die Abbuchung, die dem Belegdatum am
 * naechsten liegt -- nach demselben Fenster, nach dem auch
 * `waehleNachDatum` entscheidet. Bei gleichem Abstand entscheidet die
 * Kennung, damit zwei Laeufe dasselbe Ergebnis haben.
 *
 * Die unterlegenen Vorschlaege werden NICHT weggeworfen, sondern auf
 * "unsicher" gesetzt und nennen den Grund. Eine weggeworfene Abbuchung
 * waere eine stillschweigend unbelegte Ausgabe; eine unsichere steht
 * auf der Liste und wartet auf einen Blick.
 */
export function entwirreMehrfachnutzung(
  vorschlaege: BelegVorschlag[],
  buchungstag: Map<string, string | null>,
  belegdatum: Map<string, string | null>,
): BelegVorschlag[] {
  // Wer beansprucht welchen Beleg? Haupttreffer und Teillieferungen
  // zaehlen gleich -- festgeschrieben werden beide.
  const anspruch = new Map<string, number[]>();
  vorschlaege.forEach((v, i) => {
    if (v.sicherheit !== "sicher") return;
    for (const id of [v.beleg_id, ...(v.weitere ?? []).map((w) => w.beleg_id)]) {
      if (id) (anspruch.get(id) ?? anspruch.set(id, []).get(id)!).push(i);
    }
  });

  const ergebnis = vorschlaege.map((v) => ({ ...v }));
  for (const [belegId, stellen] of anspruch) {
    if (stellen.length < 2) continue;
    const bd = belegdatum.get(belegId) ?? null;
    const bewertet = stellen.map((i) => {
      const tag = buchungstag.get(ergebnis[i].buchung_id) ?? null;
      const tage = bd && tag ? tageZwischen(bd, tag) : null;
      const passt =
        tage !== null && tage >= -VORLAUF_TAGE && tage <= NACHLAUF_TAGE;
      return { i, tage, rang: passt ? Math.abs(tage!) : Number.MAX_SAFE_INTEGER };
    });
    bewertet.sort(
      (a, b) =>
        a.rang - b.rang ||
        ergebnis[a.i].buchung_id.localeCompare(ergebnis[b.i].buchung_id),
    );

    const sieger = bewertet[0];
    for (const verlierer of bewertet.slice(1)) {
      const v = ergebnis[verlierer.i];
      const grund =
        `Dieser Beleg gehoert zu einer anderen Abbuchung: Sie liegt ` +
        `${sieger.tage === null ? "naeher" : `${sieger.tage} Tage`} am ` +
        "Belegdatum. Fuer diese Bewegung fehlt der Beleg noch.";
      if (v.beleg_id === belegId) {
        v.sicherheit = "unsicher";
        v.begruendung = grund;
      } else {
        // Nur eine Teillieferung war doppelt: Der Haupttreffer bleibt,
        // der strittige Beleg faellt aus `weitere` heraus.
        v.weitere = (v.weitere ?? []).filter((w) => w.beleg_id !== belegId);
        v.begruendung = `${v.begruendung} Ein weiterer Beleg wurde nicht ` +
          "mitgebucht, weil er zu einer anderen Abbuchung naeher passt.";
      }
    }
  }
  return ergebnis;
}

export async function uebernehmeSichereBelege(): Promise<{
  uebernommen: number;
  offen: number;
}> {
  const v = await schlageBelegeVor();
  const sicher = v.filter((x) => x.sicherheit === "sicher" && x.beleg_id);

  let gebucht = 0;
  await tx(async (c) => {
    for (const x of sicher) {
      // Der Haupttreffer und, bei Teillieferungen, die weiteren Belege
      // derselben Bestellung. Ohne sie bliebe die Bewegung als
      // "teilweise belegt" stehen -- und niemand wuesste, was fehlt.
      const alle = [
        { beleg_id: x.beleg_id!, betrag: x.betrag },
        ...(x.weitere ?? []),
      ];
      for (const t of alle) {
        // RETURNING liefert nur bei einem echten INSERT eine Zeile.
        // Vorher zaehlte der Zaehler auch die vom ON CONFLICT
        // verworfenen mit und meldete mehr Arbeit, als getan war.
        const r = await c.query(
          `INSERT INTO belegbuchung (buchung_id, beleg_id, betrag, sicherheit, begruendung)
           VALUES ($1,$2,$3,'sicher',$4)
           ON CONFLICT (buchung_id, beleg_id) DO NOTHING
           RETURNING id`,
          [x.buchung_id, t.beleg_id, t.betrag, x.begruendung],
        );
        gebucht += r.rowCount ?? 0;
      }
    }
  });

  return { uebernommen: gebucht, offen: v.length - sicher.length };
}

/**
 * Mieteingänge brauchen keinen Beleg — die Sollstellung ist der Beleg.
 * Ebenso Umbuchungen zwischen eigenen Konten.
 */
export async function markiereOhneBelegpflicht(): Promise<number> {
  const r = await query<{ id: string }>(`
    UPDATE buchung b
       SET beleg_nicht_noetig = true,
           beleg_vermerk = 'Mieteingang, über die Sollstellung belegt.'
     WHERE b.betrag > 0
       AND b.beleg_nicht_noetig = false
       AND EXISTS (SELECT 1 FROM zuordnung z WHERE z.buchung_id = b.id)
    RETURNING b.id
  `);
  return r.length;
}
