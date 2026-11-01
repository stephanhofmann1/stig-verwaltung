import { query } from "./db";
import { mahnstand } from "./rueckstaende";
import { mahnbereitschaft } from "./mahnfreigabe";

/**
 * Der tägliche Lagebericht.
 *
 * Stephan bekommt ihn per Mail (so am 01.11.2026 festgelegt). Er ist der
 * Grund, warum die Anwendung überhaupt unbeobachtet laufen darf: Was sie
 * nicht meldet, merkt niemand.
 *
 * Deshalb die Leitregel für diese Datei: **Schweigen muss unmöglich sein.**
 * Ein Lauf, der nichts findet, sagt das ausdrücklich. Ein Lauf, der gar
 * nicht stattfindet, fällt dadurch auf, dass keine Mail kommt -- und der
 * Bericht nennt selbst, wann er zuletzt da war.
 *
 * Der Bericht ist reiner Text, keine HTML-Mail: Er wird auf dem Handy
 * gelesen, oft im Vorbeigehen, und soll in den ersten drei Zeilen sagen,
 * ob etwas zu tun ist.
 */

export interface Abschnitt {
  titel: string;
  /** Leer heißt: hier ist nichts, und das wird auch so gesagt. */
  zeilen: string[];
  /** Muss heute jemand etwas tun? Steuert die Betreffzeile. */
  dringend: boolean;
}

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

const datum = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso.slice(0, 10) + "T12:00:00Z"));

const tageBis = (iso: string, heute: Date) =>
  Math.round(
    (new Date(iso.slice(0, 10) + "T12:00:00Z").getTime() - heute.getTime()) /
      86_400_000,
  );

/** Nur lesen, nie werfen: Ein fehlgeschlagener Abschnitt darf den Bericht
 *  nicht verhindern. Lieber ein Bericht mit einer Fehlermeldung darin als
 *  gar keiner -- dann fiele der Ausfall nur durch Abwesenheit auf. */
async function behutsam<T>(was: string, f: () => Promise<T>, standard: T):
  Promise<{ wert: T; fehler: string | null }> {
  try {
    return { wert: await f(), fehler: null };
  } catch (e) {
    return { wert: standard, fehler: `${was}: ${(e as Error).message}` };
  }
}

// --- Fristen -----------------------------------------------------------------

interface FristZeile {
  bezeichnung: string;
  faellig_am: string;
  grundlage: string | null;
  betrag: string | null;
  haengt_an: string | null;
}

/**
 * Fristen, die näher kommen.
 *
 * Die Vorwarnzeit richtet sich danach, wer die Frist einhalten kann:
 *
 *   Frist, die man selbst erledigen kann    ab 30 Tagen dringend
 *   Frist, die an einem Dritten hängt       ab 60 Tagen dringend
 *
 * Der Unterschied ist nicht theoretisch. Die Nebenkostenabrechnung 2025
 * hängt an TEHA (Heizkostenverteiler) und an der WEG-Verwaltung Domex. Ein
 * Versorger, der nachliefern muss, braucht Wochen, und eine Mahnung an ihn
 * braucht selbst wieder eine Frist. Wer bei so etwas erst 30 Tage vorher
 * anfängt, kommt zu spät -- und bei § 556 Abs. 3 BGB heißt zu spät, dass
 * die Nachforderung weg ist.
 *
 * Im Bericht steht eine Frist ab 90 Tagen vor Ablauf.
 */
async function fristen(heute: Date): Promise<Abschnitt> {
  const zeilen = await query<FristZeile>(`
    SELECT bezeichnung, faellig_am::text, grundlage, betrag::text, haengt_an
      FROM frist
     WHERE erledigt_am IS NULL
       AND faellig_am <= CURRENT_DATE + 90
     ORDER BY faellig_am
  `);

  const aus: string[] = [];
  let dringend = false;
  for (const f of zeilen) {
    const tage = tageBis(f.faellig_am, heute);
    const wie =
      tage < 0
        ? `VERSTRICHEN seit ${-tage} Tagen`
        : tage === 0
          ? "HEUTE"
          : `in ${tage} Tagen`;
    // Hängt die Frist an jemand anderem, zählt sie früher als dringend:
    // Man kann sie nicht am letzten Tag noch selbst erledigen.
    const schwelle = f.haengt_an ? 60 : 30;
    if (tage <= schwelle) dringend = true;
    aus.push(
      `${tage <= schwelle ? "(!) " : ""}${f.bezeichnung} — ` +
        `${datum(f.faellig_am)}, ${wie}` +
        (f.betrag ? ` (${eur(Number(f.betrag))})` : "") +
        (f.grundlage ? `\n    Grundlage: ${f.grundlage}` : "") +
        (f.haengt_an ? `\n    Hängt an: ${f.haengt_an}` : ""),
    );
  }
  return { titel: "Fristen", zeilen: aus, dringend };
}

// --- Freigaben ---------------------------------------------------------------

async function freigaben(): Promise<Abschnitt> {
  const zeilen = await query<{ anzahl: string; aelteste: string | null }>(`
    SELECT count(*)::text AS anzahl, min(angelegt_am)::text AS aelteste
      FROM nachricht
     WHERE richtung = 'ausgehend' AND status = 'entwurf'
  `);
  const anzahl = Number(zeilen[0]?.anzahl ?? 0);
  if (anzahl === 0) return { titel: "Zur Freigabe", zeilen: [], dringend: false };
  const aelteste = zeilen[0].aelteste;
  const tage = aelteste ? tageBis(aelteste, new Date()) * -1 : 0;
  return {
    titel: "Zur Freigabe",
    zeilen: [
      `${anzahl} Entwürfe warten` +
        (tage > 2 ? `, der älteste seit ${tage} Tagen` : "") +
        ".",
    ],
    // Ein Entwurf, der eine Woche liegt, ist eine unbeantwortete Anfrage.
    dringend: tage > 6,
  };
}

// --- Zahlungen ---------------------------------------------------------------

async function zahlungen(): Promise<Abschnitt> {
  const [eingaenge] = await query<{ anzahl: string; summe: string | null }>(`
    SELECT count(*)::text AS anzahl, sum(b.betrag)::text AS summe
      FROM buchung b
     WHERE b.betrag > 0
       AND NOT EXISTS (SELECT 1 FROM zuordnung z WHERE z.buchung_id = b.id)
  `);
  const [pruefung] = await query<{ anzahl: string }>(`
    SELECT count(*)::text AS anzahl FROM zuordnung WHERE sicherheit = 'unsicher'
  `);

  const aus: string[] = [];
  const offen = Number(eingaenge?.anzahl ?? 0);
  if (offen > 0) {
    // Jeder unzugeordnete Eingang kann eine Miete sein. Solange er
    // unzugeordnet ist, sieht der Zahler aus wie ein Säumiger.
    aus.push(
      `${offen} Zahlungseingänge ohne Zuordnung` +
        (eingaenge.summe ? ` (${eur(Number(eingaenge.summe))})` : "") +
        ". Jeder davon kann eine Miete sein.",
    );
  }
  const unsicher = Number(pruefung?.anzahl ?? 0);
  if (unsicher > 0) aus.push(`${unsicher} Zuordnungen sind als unsicher vermerkt.`);
  return { titel: "Zahlungen", zeilen: aus, dringend: offen > 0 };
}

// --- Rückstände --------------------------------------------------------------

async function rueckstaendeAbschnitt(heute: Date): Promise<Abschnitt> {
  const stand = await mahnstand(heute);
  const bereit = await mahnbereitschaft();
  const gesperrt = bereit.freigabe === null;

  const zuSchreiben = stand.filter(
    (r) => r.stufe === "mahnung" || r.stufe === "erinnerung",
  );
  const ungeklaert = stand.filter((r) => r.offen_ohne_daten >= 1);

  const aus: string[] = [];
  if (zuSchreiben.length > 0) {
    const summe = zuSchreiben.reduce((s, r) => s + r.offen, 0);
    aus.push(
      `${zuSchreiben.length} Mietverhältnisse über der Schwelle, zusammen ` +
        `${eur(summe)}:`,
    );
    for (const r of zuSchreiben.slice(0, 8))
      aus.push(`    ${r.kontakt_name} (${r.einheit}): ${eur(r.offen)}, ` +
        `${r.tage_ueberfaellig} Tage`);
    if (zuSchreiben.length > 8)
      aus.push(`    … und ${zuSchreiben.length - 8} weitere`);
    aus.push(
      gesperrt
        ? "  Das Mahnwesen ist gesperrt — es wird nichts erzeugt und nichts versendet."
        : "  Jedes Schreiben geht einzeln über die Freigabe.",
    );
  }
  if (ungeklaert.length > 0) {
    const summe = ungeklaert.reduce((s, r) => s + r.offen_ohne_daten, 0);
    aus.push(
      `${ungeklaert.length} Mietverhältnisse mit ${eur(summe)} aus Monaten ` +
        "ohne Kontodaten. Das ist kein Rückstand, sondern ungeklärt.",
    );
  }
  // Nur dringend, wenn wirklich jemand etwas tun kann. Ein gesperrtes
  // Mahnwesen ist der gewollte Zustand, nicht ein Alarm.
  return {
    titel: "Rückstände",
    zeilen: aus,
    dringend: !gesperrt && zuSchreiben.length > 0,
  };
}

// --- Läufe -------------------------------------------------------------------

/**
 * Lebt der Zeitplaner noch?
 *
 * Das ist der wichtigste Abschnitt, weil er die Zuverlässigkeit aller
 * anderen beschreibt: Läuft der Zeitplaner nicht, sind Sollstellungen,
 * Mailabruf und Zuordnung stehengeblieben -- und alle anderen Zahlen in
 * diesem Bericht sind von gestern oder älter.
 */
async function laeufe(heute: Date): Promise<Abschnitt> {
  const zeilen = await query<{
    name: string;
    begonnen_am: string;
    ok: boolean;
    hinweise: string[];
  }>(`
    SELECT DISTINCT ON (name) name, begonnen_am::text, ok, hinweise
      FROM lauf
     ORDER BY name, begonnen_am DESC
  `);

  const ERWARTET = [
    "bankabruf",
    "mailabruf",
    "agent",
    "nachfassen",
    "sollstellungen",
  ];
  const aus: string[] = [];
  let dringend = false;

  for (const name of ERWARTET) {
    const l = zeilen.find((z) => z.name === name);
    if (!l) {
      aus.push(`${name}: noch nie gelaufen.`);
      dringend = true;
      continue;
    }
    const stunden = Math.round(
      (heute.getTime() - new Date(l.begonnen_am).getTime()) / 3_600_000,
    );
    // 26 Stunden, nicht 24: Der Zeitplaner läuft um 7 und 18 Uhr, und ein
    // Containerneustart kann einen Lauf verschieben. Erst darüber hinaus
    // steht er wirklich.
    if (stunden > 26) {
      aus.push(`${name}: letzter Lauf vor ${stunden} Stunden — der Zeitplaner steht.`);
      dringend = true;
    } else if (!l.ok) {
      aus.push(`${name}: letzter Lauf gescheitert.`);
      dringend = true;
    } else if (l.hinweise.length > 0) {
      aus.push(`${name}: ${l.hinweise.length} Hinweise — ${l.hinweise[0]}`);
    }
  }
  return { titel: "Läufe", zeilen: aus, dringend };
}

// --- Bankanbindung -----------------------------------------------------------

/**
 * Stand der FinTS-Zugaenge.
 *
 * Der wichtigste Fall ist die offene TAN: Die Bank verlangt etwa alle 90
 * Tage eine, und bis sie eingegeben ist, ruht der Abruf. Ein ruhender
 * Abruf fuehrt nach wenigen Tagen dazu, dass puenktliche Zahler als
 * saeumig erscheinen -- deshalb steht er hier als dringend, nicht als
 * Randnotiz.
 */
async function bankanbindung(heute: Date): Promise<Abschnitt> {
  const zeilen = await query<{
    bezeichnung: string;
    tan_faellig: boolean;
    tan_hinweis: string | null;
    letzter_fehler: string | null;
    letzter_abruf: string | null;
    aktiv: boolean;
  }>(`
    SELECT bezeichnung, tan_faellig, tan_hinweis, letzter_fehler,
           letzter_abruf::text, aktiv
      FROM fints_zugang
     ORDER BY bezeichnung
  `);

  if (zeilen.length === 0) {
    // Kein Zugang ist kein Fehler, aber es heisst: Der Abgleich laeuft
    // ueber Dateien, also von Hand.
    return {
      titel: "Bankanbindung",
      zeilen: [
        "Kein FinTS-Zugang eingerichtet — Kontoumsätze kommen nur über " +
          "Dateiimport herein.",
      ],
      dringend: false,
    };
  }

  const aus: string[] = [];
  let dringend = false;
  for (const z of zeilen) {
    if (!z.aktiv) {
      aus.push(`${z.bezeichnung}: abgeschaltet.`);
      continue;
    }
    if (z.tan_faellig) {
      aus.push(
        `(!) ${z.bezeichnung}: TAN nötig, der Abruf ruht. ` +
          (z.tan_hinweis ?? ""),
      );
      dringend = true;
      continue;
    }
    if (z.letzter_fehler) {
      aus.push(`(!) ${z.bezeichnung}: ${z.letzter_fehler.slice(0, 200)}`);
      dringend = true;
      continue;
    }
    if (z.letzter_abruf === null) {
      aus.push(`${z.bezeichnung}: noch nie abgerufen.`);
      dringend = true;
      continue;
    }
    const tage = tageBis(z.letzter_abruf, heute) * -1;
    if (tage > 2) {
      aus.push(
        `(!) ${z.bezeichnung}: letzter Abruf vor ${tage} Tagen.`,
      );
      dringend = true;
    }
  }
  return { titel: "Bankanbindung", zeilen: aus, dringend };
}

// --- Bereitschaft ------------------------------------------------------------

async function bereitschaftAbschnitt(): Promise<Abschnitt> {
  const b = await mahnbereitschaft();
  if (b.freigabe !== null) return { titel: "", zeilen: [], dringend: false };
  const offen = b.befunde.filter((x) => !x.erfuellt);
  if (offen.length === 0)
    return {
      titel: "Mahnwesen",
      zeilen: [
        "Alle Punkte der Bereitschaftsliste sind erfüllt. Das Mahnwesen " +
          "könnte freigegeben werden.",
      ],
      dringend: false,
    };
  return {
    titel: "Mahnwesen noch nicht bereit",
    zeilen: offen.map((x) => `${x.punkt} — ${x.erklaerung}`),
    dringend: false,
  };
}

// --- Zusammenbau -------------------------------------------------------------

export interface Bericht {
  betreff: string;
  text: string;
  dringend: boolean;
  abschnitte: Abschnitt[];
  fehler: string[];
}

export async function baueLagebericht(heute = new Date()): Promise<Bericht> {
  const teile = await Promise.all([
    behutsam("Fristen", () => fristen(heute), leer("Fristen")),
    behutsam("Läufe", () => laeufe(heute), leer("Läufe")),
    behutsam("Rückstände", () => rueckstaendeAbschnitt(heute), leer("Rückstände")),
    behutsam("Zahlungen", zahlungen, leer("Zahlungen")),
    behutsam("Bankanbindung", () => bankanbindung(heute), leer("Bankanbindung")),
    behutsam("Freigaben", freigaben, leer("Zur Freigabe")),
    behutsam("Bereitschaft", bereitschaftAbschnitt, leer("")),
  ]);

  const abschnitte = teile.map((t) => t.wert);
  const fehler = teile.map((t) => t.fehler).filter((f): f is string => f !== null);
  const dringend = abschnitte.some((a) => a.dringend);

  const mitInhalt = abschnitte.filter((a) => a.titel !== "" && a.zeilen.length > 0);

  const tag = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(heute);

  const kopf = dringend
    ? "Es ist etwas zu tun."
    : mitInhalt.length === 0
      ? "Nichts zu tun. Alle Läufe sind durch, keine Fristen in Sicht, keine Rückstände über der Schwelle."
      : "Nichts Dringendes. Zur Kenntnis:";

  const zeilen: string[] = [`Lagebericht ${tag}`, "", kopf, ""];
  for (const a of mitInhalt) {
    zeilen.push(`## ${a.titel}${a.dringend ? "  (!)" : ""}`);
    for (const z of a.zeilen) zeilen.push(`  ${z}`);
    zeilen.push("");
  }

  if (fehler.length > 0) {
    // Ein Abschnitt, der nicht gelesen werden konnte, ist selbst eine
    // Meldung. Ihn stillschweigend weglassen hieße, eine Lücke als
    // "nichts zu tun" auszugeben.
    zeilen.push("## Nicht lesbar");
    for (const f of fehler) zeilen.push(`  ${f}`);
    zeilen.push("");
  }

  zeilen.push(
    "— Dieser Bericht kommt täglich. Kommt er nicht, steht der Zeitplaner.",
  );

  return {
    betreff:
      (dringend ? "STIG: zu tun — " : "STIG: alles ruhig — ") +
      new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" })
        .format(heute),
    text: zeilen.join("\n"),
    dringend,
    abschnitte,
    fehler,
  };
}

function leer(titel: string): Abschnitt {
  return { titel, zeilen: [], dringend: false };
}
