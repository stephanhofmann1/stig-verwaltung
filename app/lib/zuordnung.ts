import { query, tx } from "./db";

/**
 * Ordnet Kontobuchungen den fälligen Mieten zu.
 *
 * Die Regeln stammen aus dem Abgleich vom 12.10.2026 über zwölf Monate:
 *
 *  1. Monatsversatz — wer am Monatsletzten zahlt, zahlt für den Folgemonat.
 *     Betrifft rund ein Dutzend Mietverhaeltnisse in beiden Objekten.
 *     Ohne diese Regel entstehen Scheinluecken und Scheindoppel.
 *  2. Verwendungszweck schlägt Absendername — Angehörige und Dritte
 *     überweisen unter eigenem Namen.
 *  3. Auslandszahlungen (Wise, SEPA mit Adresszeile) haben keinen
 *     brauchbaren Zweck. Zuordnung nur über Betrag und Zeitpunkt, und
 *     die gilt grundsätzlich als unsicher.
 *  4. Barzahlungen stehen auf keinem Auszug. Eine Lücke ist deshalb
 *     niemals für sich genommen ein Rückstand.
 *
 * Alles, was nicht eindeutig ist, wird als "unsicher" markiert und landet
 * in der Prüfliste — nicht in einer Mahnung.
 */

export type Sicherheit = "sicher" | "unsicher" | "bestaetigt";

export interface OffeneBuchung {
  id: string;
  buchungstag: string;
  betrag: string;
  absender: string | null;
  verwendungszweck: string | null;
  konto_id: string;
  objekt_id: string | null;
}

interface SollKandidat {
  soll_id: string;
  mietverhaeltnis_id: string;
  monat: string;
  betrag: string;
  offen: string;
  kontakt_id: string;
  kontakt_name: string;
  einheit: string;
  objekt_id: string;
  zahlt_im_voraus: boolean;
}

const AUSLAND = /\b(wise|transferwise|sepa.?auslands|iban\s*[A-Z]{2}(?!DE))/i;

/** Normalisiert Text für den Vergleich: Umlaute, Kleinschreibung, Rauschen weg. */
export function vergleichbar(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Für welchen Monat ist diese Zahlung gedacht?
 * Nennt der Verwendungszweck einen Monat, gilt der. Sonst entscheidet
 * der Buchungstag — ab dem 25. zählt sie für den Folgemonat, sofern der
 * Mieter als Vorauszahler geführt wird.
 */
export function zielmonat(
  buchungstag: string,
  zweck: string | null,
  zahltImVoraus: boolean,
): { monat: string; ausZweck: boolean } {
  const t = vergleichbar(zweck);
  const namen = [
    "januar","februar","maerz","april","mai","juni",
    "juli","august","september","oktober","november","dezember",
  ];
  const jahrTreffer = t.match(/\b(20\d{2})\b/);
  for (let i = 0; i < namen.length; i++) {
    if (t.includes(namen[i])) {
      const jahr = jahrTreffer ? Number(jahrTreffer[1]) : new Date(buchungstag).getFullYear();
      return {
        monat: `${jahr}-${String(i + 1).padStart(2, "0")}-01`,
        ausZweck: true,
      };
    }
  }
  // Formate wie 10/2026 oder 2026-10 — am Originaltext geprüft, weil die
  // Normalisierung Schrägstriche und Bindestriche entfernt.
  const roh = zweck ?? "";
  const m1 = roh.match(/\b(0?[1-9]|1[0-2])\s*[\/.]\s*(20\d{2})\b/);
  if (m1)
    return {
      monat: `${m1[2]}-${String(Number(m1[1])).padStart(2, "0")}-01`,
      ausZweck: true,
    };
  const m2 = roh.match(/\b(20\d{2})\s*[-\/]\s*(0?[1-9]|1[0-2])\b/);
  if (m2)
    return {
      monat: `${m2[1]}-${String(Number(m2[2])).padStart(2, "0")}-01`,
      ausZweck: true,
    };

  const d = new Date(buchungstag + "T00:00:00Z");
  const imVoraus = zahltImVoraus && d.getUTCDate() >= 25;
  // Erst auf den Monatsersten setzen, dann den Monat erhöhen. Sonst kippt
  // der 31. Oktober plus ein Monat auf den 1. Dezember statt November.
  d.setUTCDate(1);
  if (imVoraus) d.setUTCMonth(d.getUTCMonth() + 1);
  return {
    monat: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`,
    ausZweck: false,
  };
}

/** Noch nicht vollständig zugeordnete Eingänge. */
export async function offeneBuchungen(): Promise<OffeneBuchung[]> {
  return query<OffeneBuchung>(`
    SELECT b.id, b.buchungstag::text, b.betrag::text, b.absender,
           b.verwendungszweck, b.konto_id, k.objekt_id
      FROM buchung b
      JOIN konto k ON k.id = b.konto_id
     WHERE b.betrag > 0
       AND b.betrag > COALESCE(
             (SELECT sum(z.betrag) FROM zuordnung z WHERE z.buchung_id = b.id), 0)
     ORDER BY b.buchungstag ASC
  `);
}

/** Offene Sollstellungen samt Mieter, Einheit und Zahlgewohnheit. */
async function sollKandidaten(objektId: string | null): Promise<SollKandidat[]> {
  return query<SollKandidat>(
    `SELECT s.id AS soll_id, s.mietverhaeltnis_id, s.monat::text, s.betrag::text,
            (s.betrag - COALESCE(
               (SELECT sum(z.betrag) FROM zuordnung z
                 WHERE z.sollstellung_id = s.id), 0))::text AS offen,
            mv.kontakt_id, k.anzeigename AS kontakt_name,
            e.bezeichnung AS einheit, e.objekt_id,
            mv.zahlt_im_voraus
       FROM sollstellung s
       JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
       JOIN kontakt k  ON k.id = mv.kontakt_id
       JOIN einheit e  ON e.id = mv.einheit_id
      WHERE ($1::uuid IS NULL OR e.objekt_id = $1)
        AND s.betrag > COALESCE(
              (SELECT sum(z.betrag) FROM zuordnung z
                WHERE z.sollstellung_id = s.id), 0)
      ORDER BY s.monat ASC`,
    [objektId],
  );
}

/** Zusätzliche Namen, unter denen für einen Mieter gezahlt wird. */
async function erkennungen(): Promise<Array<{ kontakt_id: string; muster: string; feld: string }>> {
  return query(`SELECT kontakt_id, muster, feld FROM zahlerkennung`);
}

export interface Vorschlag {
  buchung_id: string;
  soll_id: string | null;
  betrag: number;
  sicherheit: Sicherheit;
  begruendung: string;
  kontakt_name?: string;
  einheit?: string;
  monat?: string;
}

/** Erzeugt Zuordnungsvorschläge für alle offenen Buchungen. */
export async function schlageZuordnungenVor(): Promise<Vorschlag[]> {
  const buchungen = await offeneBuchungen();
  const alleErkennungen = await erkennungen();
  const vorschlaege: Vorschlag[] = [];

  for (const b of buchungen) {
    const kandidaten = await sollKandidaten(b.objekt_id);
    const betrag = Number(b.betrag);
    const absender = vergleichbar(b.absender);
    const zweck = vergleichbar(b.verwendungszweck);
    const text = `${absender} ${zweck}`;
    const ausland = AUSLAND.test(b.absender ?? "") || AUSLAND.test(b.verwendungszweck ?? "");

    // 1. Mieter bestimmen — über Name, Verwendungszweck oder gelernte Muster.
    const treffer = kandidaten.filter((k) => {
      const name = vergleichbar(k.kontakt_name);
      const teile = name.split(" ").filter((t) => t.length >= 3);
      if (teile.some((t) => text.includes(t))) return true;
      return alleErkennungen.some(
        (e) =>
          e.kontakt_id === k.kontakt_id &&
          (e.feld === "beide"
            ? text.includes(vergleichbar(e.muster))
            : e.feld === "absender"
              ? absender.includes(vergleichbar(e.muster))
              : zweck.includes(vergleichbar(e.muster))),
      );
    });

    const menge = treffer.length > 0 ? treffer : kandidaten;
    const ueberName = treffer.length > 0;

    if (menge.length === 0) {
      vorschlaege.push({
        buchung_id: b.id,
        soll_id: null,
        betrag,
        sicherheit: "unsicher",
        begruendung: "Keine offene Sollstellung gefunden, zu der die Buchung passen könnte.",
      });
      continue;
    }

    // 2. Monat bestimmen und passende Sollstellung wählen.
    const kontakte = Array.from(new Set(menge.map((k) => k.kontakt_id)));
    const vorausKandidat = menge.find((k) => k.zahlt_im_voraus) ?? menge[0];
    const { monat, ausZweck } = zielmonat(
      b.buchungstag,
      b.verwendungszweck,
      vorausKandidat.zahlt_im_voraus,
    );

    const imMonat = menge.filter((k) => k.monat.slice(0, 7) === monat.slice(0, 7));
    const betragsTreffer = (ueberName ? menge : menge).filter(
      (k) => Math.abs(Number(k.offen) - betrag) < 0.005,
    );

    let gewaehlt: SollKandidat | undefined;
    const gruende: string[] = [];
    let sicherheit: Sicherheit = "sicher";

    if (ueberName && imMonat.length === 1) {
      gewaehlt = imMonat[0];
      gruende.push(
        ausZweck
          ? "Mieter über Name oder Verwendungszweck erkannt, Monat steht im Verwendungszweck."
          : vorausKandidat.zahlt_im_voraus && new Date(b.buchungstag + "T00:00:00Z").getUTCDate() >= 25
            ? "Mieter erkannt. Zahlung am Monatsende gilt bei diesem Mieter für den Folgemonat."
            : "Mieter erkannt, Monat aus dem Buchungstag.",
      );
    } else if (ueberName && imMonat.length === 0 && menge.length === 1) {
      gewaehlt = menge[0];
      sicherheit = "unsicher";
      gruende.push(
        "Mieter erkannt, aber für den errechneten Monat ist nichts offen. Vermutlich eine Nachzahlung.",
      );
    } else if (!ueberName && betragsTreffer.length === 1) {
      gewaehlt = betragsTreffer[0];
      sicherheit = "unsicher";
      gruende.push(
        ausland
          ? "Auslandszahlung ohne verwertbaren Verwendungszweck. Zuordnung allein über den Betrag."
          : "Absender und Verwendungszweck passen zu keinem Mieter. Zuordnung allein über den Betrag.",
      );
    } else if (ueberName && imMonat.length > 1) {
      gewaehlt = imMonat[0];
      sicherheit = "unsicher";
      gruende.push(
        `Mehrere offene Sollstellungen im selben Monat für ${kontakte.length > 1 ? "mehrere Mieter" : "diesen Mieter"}. Erster Treffer vorgeschlagen.`,
      );
    } else {
      vorschlaege.push({
        buchung_id: b.id,
        soll_id: null,
        betrag,
        sicherheit: "unsicher",
        begruendung: ausland
          ? "Auslandszahlung, keine eindeutige Zuordnung möglich."
          : "Kein eindeutiger Treffer über Name, Verwendungszweck oder Betrag.",
      });
      continue;
    }

    const offen = Number(gewaehlt.offen);
    const zuordnungsbetrag = Math.min(betrag, offen);
    if (zuordnungsbetrag < betrag - 0.005) {
      gruende.push(
        `Buchung ist höher als der offene Betrag — es werden ${zuordnungsbetrag.toFixed(2)} € zugeordnet, der Rest bleibt offen.`,
      );
      if (sicherheit === "sicher") sicherheit = "unsicher";
    }

    vorschlaege.push({
      buchung_id: b.id,
      soll_id: gewaehlt.soll_id,
      betrag: zuordnungsbetrag,
      sicherheit,
      begruendung: gruende.join(" "),
      kontakt_name: gewaehlt.kontakt_name,
      einheit: gewaehlt.einheit,
      monat: gewaehlt.monat,
    });
  }

  return vorschlaege;
}

/**
 * Schreibt die sicheren Vorschläge fest. Unsichere bleiben Vorschlag und
 * warten auf Bestätigung in der Prüfliste.
 */
export async function uebernehmeSichere(): Promise<{
  uebernommen: number;
  zurPruefung: number;
}> {
  const vorschlaege = await schlageZuordnungenVor();
  const sicher = vorschlaege.filter((v) => v.sicherheit === "sicher" && v.soll_id);

  await tx(async (c) => {
    for (const v of sicher) {
      await c.query(
        `INSERT INTO zuordnung (buchung_id, sollstellung_id, betrag, sicherheit, begruendung)
         VALUES ($1,$2,$3,'sicher',$4)
         ON CONFLICT (buchung_id, sollstellung_id) DO NOTHING`,
        [v.buchung_id, v.soll_id, v.betrag, v.begruendung],
      );
    }
  });

  return {
    uebernommen: sicher.length,
    zurPruefung: vorschlaege.length - sicher.length,
  };
}
