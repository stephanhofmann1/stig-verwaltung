/**
 * Lücken in den Kontodaten finden.
 *
 * Die Frage, die sich beim Nachladen jedes Mal stellt: Welche Monate habe
 * ich eigentlich? Die Buchungen allein beantworten das nicht -- sie sagen,
 * was angekommen ist, nicht was fehlt. Ein Monat ohne jede Buchung auf
 * einem Mietkonto ist aber kein Monat ohne Zahlungen, sondern ein Monat
 * ohne Daten. Und für genau diese Monate würde die Plattform sonst
 * Rückstände errechnen.
 *
 * Der laufende Monat bleibt bewusst aussen vor: Er ist naturgemäß
 * unvollständig, und eine Warnung, die am Monatsersten erscheint und am
 * Dritten wieder verschwindet, lernt man zu ignorieren. Wie aktuell der
 * Stand ist, sagt die Bereitschaftsliste über das Alter der jüngsten
 * Buchung -- jedes Signal hat genau einen Zuständigen.
 */

/** "2025-07-31" -> "2025-07" */
function monatVon(iso: string): string {
  return iso.slice(0, 7);
}

/** "2025-07" -> "2025-08" */
function naechsterMonat(m: string): string {
  const j = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12
    ? `${j + 1}-01`
    : `${j}-${String(mo + 1).padStart(2, "0")}`;
}

/**
 * Die Monate zwischen `von` und dem Monat vor `bis`, für die kein
 * einziger Buchungstag vorliegt.
 *
 * `von` ist der Beginn der Kontodaten (objekt.zahlungsdaten_ab) oder die
 * erste Buchung. Ohne ihn gibt es nichts zu melden: Dann ist nicht
 * bekannt, ab wann überhaupt Daten erwartet werden -- und dort wird auch
 * nicht gemahnt.
 */
export function fehlendeMonate(
  von: string | null | undefined,
  bis: string,
  vorhandeneBuchungstage: string[],
): string[] {
  if (!von) return [];
  const start = monatVon(von);
  const laufend = monatVon(bis);

  const da = new Set(vorhandeneBuchungstage.map(monatVon));
  const fehlt: string[] = [];

  let m = start;
  // Bis AUSSCHLIESSLICH zum laufenden Monat.
  while (m < laufend) {
    if (!da.has(m)) fehlt.push(m);
    m = naechsterMonat(m);
    // Sicherung gegen eine Endlosschleife bei unsinnigen Eingaben --
    // etwa von in der Zukunft. 1200 Monate sind hundert Jahre.
    if (fehlt.length > 1200) break;
  }
  return fehlt;
}

/** "2025-07" -> "Juli 2025", für die Anzeige. */
export function monatsName(m: string): string {
  const [j, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(j, mo - 1, 1)));
}

/**
 * Fasst aufeinanderfolgende Monate zusammen: aus zwölf Einzelmonaten wird
 * "Dezember 2024 – November 2025". Eine Liste von zwölf Zeilen liest
 * niemand, eine Spanne schon.
 */
export function fasseZusammen(monate: string[]): string[] {
  if (monate.length === 0) return [];
  const sortiert = [...monate].sort();
  const spannen: string[] = [];
  let anfang = sortiert[0];
  let ende = sortiert[0];

  for (const m of sortiert.slice(1)) {
    if (m === naechsterMonat(ende)) {
      ende = m;
    } else {
      spannen.push(
        anfang === ende
          ? monatsName(anfang)
          : `${monatsName(anfang)} – ${monatsName(ende)}`,
      );
      anfang = m;
      ende = m;
    }
  }
  spannen.push(
    anfang === ende
      ? monatsName(anfang)
      : `${monatsName(anfang)} – ${monatsName(ende)}`,
  );
  return spannen;
}
