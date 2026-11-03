import { tx } from "./db";
import type { Kategorie } from "./typen";

/**
 * Dauerhafte Weisungen an den Entwurfsagenten.
 *
 * WARUM DIESE DATEI EXISTIERT
 *
 * Der Agent hat bis zum 03.11.2026 zwei Dinge gekonnt: einen Textbaustein
 * einsetzen oder das Sprachmodell einmal fragen. Am Ergebnis war nichts zu
 * steuern. Eine Korrektur, die man bei jeder Mail neu eintippen muss, ist
 * aber keine Hilfe -- und ohne stehende Weisungen ersetzt diese Plattform
 * kein Postfach.
 *
 * Drei Ebenen, von allgemein nach eng:
 *
 *   allgemein  "schreib kurz, höchstens fünf Sätze"
 *   kategorie  "bei Handwerkern immer nach einem Termin fragen"
 *   kontakt    "der schreibt Englisch, antworte auf Englisch"
 *
 * Alle drei wirken ZUSAMMEN -- sie ersetzen sich nicht. Bei Widerspruch
 * gilt die engere: Kontakt schlägt Kategorie schlägt allgemein. Darum
 * liefert setzeWeisungenZusammen() eine nach Vorrang aufsteigend
 * sortierte Liste und nicht nur einen Text: Die Oberfläche muss zeigen
 * können, WELCHE Weisung von WELCHER Ebene gewirkt hat. Eine unsichtbare
 * Dauerweisung, die einen Text verändert, ist schlimmer als keine --
 * dann steht in der Mail etwas, das sich niemand erklären kann.
 *
 * WAS EINE WEISUNG NICHT KANN
 *
 * Eine Weisung ist vom Nutzer geschriebener Text, der in einen Prompt
 * wandert. Sie kann also alles verlangen, auch "sende das sofort". Die
 * Sicherung dagegen ist ausdrücklich NICHT eine Prüfung ihres Inhalts --
 * eine solche Prüfung ließe sich umschreiben. Die Sicherung ist, dass im
 * Code hinter dem Entwurf kein Versandweg liegt: Diese Datei und
 * lib/agent.ts rufen sendeEntwurf() nicht auf, kennen keine Resend- und
 * keine SMTP-Adresse und können nichts anderes erzeugen als eine
 * Nachricht mit status='entwurf'. Gesendet wird allein über die Freigabe,
 * auf die ein Mensch klickt. app/tests/weisungen.test.ts hält das fest.
 *
 * MANDANTENGRENZE
 *
 * Diese Datei liest Text, der die Geschäftskorrespondenz eines
 * Unternehmens prägt. Eine über die Mandantengrenze gelesene Weisung
 * veränderte die Korrespondenz eines fremden Unternehmens, und beim
 * Empfänger käme das als Absicht des Absenders an. Das ist der teuerste
 * Fehler, den dieses Produkt machen kann. Geladen wird deshalb
 * ausnahmslos über tx() aus lib/db.ts -- das setzt SET LOCAL app.mandant
 * für die Dauer der Transaktion, und db/031 verlangt per Policy
 * (FORCE ROW LEVEL SECURITY) mandant_id = aktueller_mandant(). Ohne
 * gesetzten Mandanten liefert aktueller_mandant() NULL, und damit kommen
 * KEINE Zeilen zurück statt aller.
 */

export type Ebene = "allgemein" | "kategorie" | "kontakt";

/**
 * Der Vorrang je Ebene. Höher schlägt niedriger.
 *
 * Als Zahlen und nicht als Reihenfolge einer Liste: Eine Zahl lässt sich
 * vergleichen, mitschreiben und in der Oberfläche anzeigen. Wer später
 * eine vierte Ebene einfügt (etwa "je Objekt"), vergibt eine Zahl
 * dazwischen und muss keine Sortierfunktion anfassen.
 */
export const EBENEN_VORRANG: Record<Ebene, number> = {
  allgemein: 1,
  kategorie: 2,
  kontakt: 3,
};

export const EBENE_LABEL: Record<Ebene, string> = {
  allgemein: "Für alles",
  kategorie: "Je Kategorie",
  kontakt: "Je Kontakt",
};

/**
 * Höchstlänge einer Weisung.
 *
 * Nicht aus Sparsamkeit: Der Prompt trägt den Mailverlauf, den bisherigen
 * Entwurf und sämtliche Weisungen. Eine einzelne Weisung von mehreren
 * Seiten verdrängt den Verlauf, und dann antwortet das Modell an der
 * eigentlichen Nachricht vorbei. Zweitausend Zeichen sind etwa eine
 * halbe Seite -- genug für jede Anweisung, die noch eine ist.
 */
export const WEISUNG_MAX_LAENGE = 2000;

/** Eine Weisung, wie sie in db/031 steht. */
export interface Weisung {
  id: string;
  ebene: Ebene;
  kategorie: Kategorie | null;
  kontakt_id: string | null;
  weisungstext: string;
  aktiv: boolean;
  rang: number;
  angelegt_am?: string | null;
}

/** Eine Weisung, die bei diesem Entwurf tatsächlich gewirkt hat. */
export interface WirksameWeisung {
  id: string;
  ebene: Ebene;
  /** 1 = allgemein, 2 = Kategorie, 3 = Kontakt. Höher schlägt niedriger. */
  vorrang: number;
  weisungstext: string;
  kategorie: Kategorie | null;
  kontakt_id: string | null;
}

/** Eine Weisung, die es gibt und die hier nicht gewirkt hat -- mit Grund. */
export interface UebergangeneWeisung {
  id: string;
  ebene: Ebene;
  weisungstext: string;
  grund: string;
}

export interface Weisungslage {
  /** Aufsteigend nach Vorrang: allgemein zuerst, Kontakt zuletzt. */
  wirksam: WirksameWeisung[];
  /**
   * Die Weisung mit dem höchsten Vorrang, oder null.
   *
   * Bei Widerspruch ist das die, die gilt. Eigenes Feld, damit die
   * Oberfläche und der Test dieselbe Antwort bekommen, ohne die
   * Sortierung nachzurechnen.
   */
  staerkste: WirksameWeisung | null;
  /** Vorhandene, hier nicht wirksame Weisungen -- für die Erklärung. */
  uebergangen: UebergangeneWeisung[];
}

/** Worauf sich die Weisungen beziehen sollen. */
export interface Bezug {
  kategorie: Kategorie | null;
  kontaktId: string | null;
}

/**
 * Setzt die Weisungen für einen konkreten Entwurf zusammen.
 *
 * Reine Funktion: keine Datenbank, keine Uhrzeit. Der Grund ist derselbe
 * wie bei lib/vorgangstatus.ts -- die Rangfolge ist die Stelle, an der
 * ein Fehler teuer wird, und sie muss ohne Postgres prüfbar sein, sonst
 * wird sie nie geprüft.
 *
 * Inaktive Weisungen und solche, die zu einer anderen Kategorie oder
 * einem anderen Kontakt gehören, landen in `uebergangen` statt still zu
 * verschwinden. Wer auf der Weisungsseite etwas einträgt und es im
 * Entwurf nicht wiederfindet, muss sehen, warum.
 */
export function setzeWeisungenZusammen(
  alle: Weisung[],
  bezug: Bezug,
): Weisungslage {
  const wirksam: WirksameWeisung[] = [];
  const uebergangen: UebergangeneWeisung[] = [];

  for (const w of alle) {
    const uebergehen = (grund: string) =>
      uebergangen.push({
        id: w.id,
        ebene: w.ebene,
        weisungstext: w.weisungstext,
        grund,
      });

    if (!w.aktiv) {
      uebergehen("Abgeschaltet.");
      continue;
    }
    if (!w.weisungstext.trim()) {
      // Leerer Text ist in db/031 per CHECK verboten. Hier trotzdem
      // abgefangen: Diese Funktion bekommt ihre Liste auch aus einem
      // Formular, nicht nur aus der Tabelle.
      uebergehen("Kein Text.");
      continue;
    }
    if (w.ebene === "kategorie") {
      if (!bezug.kategorie) {
        uebergehen("Der Vorgang hat keine Kategorie.");
        continue;
      }
      if (w.kategorie !== bezug.kategorie) {
        uebergehen(`Gilt für eine andere Kategorie (${w.kategorie}).`);
        continue;
      }
    }
    if (w.ebene === "kontakt") {
      if (!bezug.kontaktId) {
        uebergehen("Der Vorgang hängt an keinem Kontakt.");
        continue;
      }
      if (w.kontakt_id !== bezug.kontaktId) {
        uebergehen("Gilt für einen anderen Kontakt.");
        continue;
      }
    }

    wirksam.push({
      id: w.id,
      ebene: w.ebene,
      vorrang: EBENEN_VORRANG[w.ebene],
      weisungstext: w.weisungstext.trim().slice(0, WEISUNG_MAX_LAENGE),
      kategorie: w.kategorie,
      kontakt_id: w.kontakt_id,
    });
  }

  // Aufsteigend: Das Allgemeine steht im Prompt oben, das Engere unten.
  // Sprachmodelle gewichten spätere Anweisungen stärker, und derselbe
  // Aufbau ist auch für den Leser der richtige -- vom Rahmen zum Einzelfall.
  const reihenfolge = new Map(alle.map((w, i) => [w.id, i]));
  const raenge = new Map(alle.map((w) => [w.id, w.rang ?? 0]));
  wirksam.sort((a, b) => {
    if (a.vorrang !== b.vorrang) return a.vorrang - b.vorrang;
    const ra = raenge.get(a.id) ?? 0;
    const rb = raenge.get(b.id) ?? 0;
    if (ra !== rb) return ra - rb;
    // Letzter Anker: die Reihenfolge, in der sie hereinkamen. Ohne den
    // waere die Sortierung bei gleichem Vorrang und gleichem Rang von
    // der Laufzeit abhaengig -- und damit der Prompt nicht reproduzierbar.
    return (reihenfolge.get(a.id) ?? 0) - (reihenfolge.get(b.id) ?? 0);
  });

  return {
    wirksam,
    staerkste: wirksam.length ? wirksam[wirksam.length - 1] : null,
    uebergangen,
  };
}

/**
 * Der Textblock, der in den Prompt wandert.
 *
 * Leere Lage ergibt den leeren String und nicht etwa eine Überschrift
 * ohne Inhalt: Eine Zeile "Dauerhafte Weisungen:" ohne eine einzige
 * darunter liest das Modell als Aufforderung, sich welche zu denken.
 *
 * Der Vorspann sagt zweierlei, und beides ist nötig: dass bei Widerspruch
 * die engere Weisung gilt, und dass eine Weisung nur Inhalt und Ton
 * betrifft. Der zweite Satz ist Prompt-Hygiene und ausdrücklich NICHT die
 * Sicherung gegen einen Versand -- die liegt darin, dass hinter dem
 * Entwurf im Code kein Versandweg existiert (siehe Kopf dieser Datei).
 */
export function baueWeisungsblock(lage: Weisungslage): string {
  if (lage.wirksam.length === 0) return "";

  const zeilen = lage.wirksam.map(
    (w) => `- [${EBENE_LABEL[w.ebene]}] ${w.weisungstext}`,
  );

  return [
    "Dauerhafte Weisungen der Verwaltung. Sie gelten zusätzlich zu den",
    "Regeln oben. Widersprechen sie sich, gilt die engere: „Je Kontakt“",
    "schlägt „Je Kategorie“ schlägt „Für alles“. Sie betreffen",
    "ausschließlich Inhalt, Ton und Sprache deines Textes — du löst damit",
    "nichts aus, versendest nichts und vereinbarst nichts. Dein Ergebnis",
    "ist ein Entwurf, den ein Mensch liest, bevor er hinausgeht.",
    "",
    ...zeilen,
  ].join("\n");
}

/**
 * Prüft, was aus einem Formular kommt, bevor es in die Tabelle geht.
 *
 * Reine Funktion mit `unknown`-Eingabe, nach dem Muster von
 * lib/vorgangstatus.ts: Diese Werte sind ungeprüfte Eingabe, und die
 * Prüfung ist die Aufgabe dieser Funktion. Eine Signatur mit `ebene:
 * Ebene` wäre ein Versprechen, das der Aufrufer nicht halten kann.
 */
export type WeisungPruefung =
  | {
      ok: true;
      ebene: Ebene;
      kategorie: Kategorie | null;
      kontaktId: string | null;
      weisungstext: string;
      rang: number;
    }
  | { ok: false; fehler: string };

const EBENEN = Object.keys(EBENEN_VORRANG) as Ebene[];

export function istEbene(wert: unknown): wert is Ebene {
  return typeof wert === "string" && (EBENEN as string[]).includes(wert);
}

export function pruefeWeisung(eingabe: {
  ebene?: unknown;
  kategorie?: unknown;
  kontakt_id?: unknown;
  weisungstext?: unknown;
  rang?: unknown;
}): WeisungPruefung {
  if (!istEbene(eingabe.ebene)) {
    return {
      ok: false,
      fehler: `Unbekannte Ebene. Möglich sind: ${EBENEN.join(", ")}.`,
    };
  }
  const text =
    typeof eingabe.weisungstext === "string" ? eingabe.weisungstext.trim() : "";
  if (text.length < 3) {
    return {
      ok: false,
      fehler:
        "Die Weisung braucht einen Text von mindestens drei Zeichen. " +
        "Eine leere Weisung stünde in der Liste und würde nie wirken.",
    };
  }
  if (text.length > WEISUNG_MAX_LAENGE) {
    return {
      ok: false,
      fehler:
        `Die Weisung ist länger als ${WEISUNG_MAX_LAENGE} Zeichen. So lange ` +
        "verdrängt sie den Mailverlauf im Prompt, und die Antwort geht an " +
        "der Nachricht vorbei.",
    };
  }

  // Der CHECK in db/031 verlangt dasselbe. Hier steht es trotzdem, weil
  // eine Fehlermeldung aus Postgres für den Nutzer keine ist.
  if (eingabe.ebene === "allgemein") {
    return {
      ok: true,
      ebene: "allgemein",
      kategorie: null,
      kontaktId: null,
      weisungstext: text,
      rang: typeof eingabe.rang === "number" ? eingabe.rang : 0,
    };
  }
  if (eingabe.ebene === "kategorie") {
    if (typeof eingabe.kategorie !== "string" || !eingabe.kategorie) {
      return {
        ok: false,
        fehler: "Eine Weisung je Kategorie braucht eine Kategorie.",
      };
    }
    return {
      ok: true,
      ebene: "kategorie",
      kategorie: eingabe.kategorie as Kategorie,
      kontaktId: null,
      weisungstext: text,
      rang: typeof eingabe.rang === "number" ? eingabe.rang : 0,
    };
  }
  if (
    typeof eingabe.kontakt_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(eingabe.kontakt_id)
  ) {
    return {
      ok: false,
      fehler: "Eine Weisung je Kontakt braucht einen Kontakt.",
    };
  }
  return {
    ok: true,
    ebene: "kontakt",
    kategorie: null,
    kontaktId: eingabe.kontakt_id,
    weisungstext: text,
    rang: typeof eingabe.rang === "number" ? eingabe.rang : 0,
  };
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

/**
 * Alle Weisungen des angemeldeten Mandanten.
 *
 * Über tx() und nicht über query(): Beide setzen app.mandant, aber tx()
 * ist der Weg, den db/010 für Mandantendaten vorsieht, und hier zählt
 * das mehr als irgendwo sonst -- siehe Kopf dieser Datei.
 *
 * `nurAktive` ist der Vorgabefall für den Prompt; die Weisungsseite
 * braucht auch die abgeschalteten, sonst kann sie niemand wieder
 * einschalten.
 */
export async function ladeWeisungen(nurAktive = false): Promise<Weisung[]> {
  return tx(async (c) => {
    const r = await c.query<Weisung>(
      `SELECT id, ebene, kategorie, kontakt_id, weisungstext, aktiv, rang,
              angelegt_am::text
         FROM weisung
        ${nurAktive ? "WHERE aktiv" : ""}
        ORDER BY rang ASC, angelegt_am ASC`,
    );
    return r.rows;
  });
}

/**
 * Die Weisungslage für einen Vorgang -- genau das, was in den Prompt geht.
 *
 * Lädt nur die aktiven: Was abgeschaltet ist, soll keinen Entwurf prägen.
 * Die Oberfläche zeigt die abgeschalteten auf der Weisungsseite.
 */
export async function ladeWeisungslage(bezug: Bezug): Promise<Weisungslage> {
  const alle = await ladeWeisungen(true);
  return setzeWeisungenZusammen(alle, bezug);
}
