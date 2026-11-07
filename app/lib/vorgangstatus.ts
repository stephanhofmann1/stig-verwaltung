import {
  HEIKLE_KATEGORIEN,
  KATEGORIE_LABEL,
  STATUS_LABEL,
  type Kategorie,
  type VorgangStatus,
} from "./typen";

/**
 * Was an einem Vorgang geaendert werden darf -- und was darueber im
 * Protokoll stehen muss.
 *
 * Reine Entscheidungslogik: keine Datenbank, keine Uhrzeit, keine Sitzung,
 * kein next/*. Der Grund ist derselbe wie bei lib/mahnstufen.ts: Die Frage
 * "darf dieser Wechsel sein, und was wird darueber vermerkt" ist die
 * Stelle, an der ein Fehler teuer wird. Sie muss ohne Postgres pruefbar
 * sein, sonst wird sie nie geprueft.
 *
 * Drei Dinge entscheidet diese Datei:
 *
 *   1. Welcher Statuswechsel erlaubt ist. Nicht jeder: Ein erledigter
 *      Vorgang geht nicht direkt auf "wartet". "Wartet" heisst, dass
 *      draussen jemand antworten soll -- bei einem abgeschlossenen Vorgang
 *      wartet niemand. Wer ihn wieder braucht, oeffnet ihn, und dann ist
 *      er offen. Ein Weg ueber zwei Schritte ist hier besser als ein
 *      Status, der nichts mehr aussagt.
 *
 *   2. Dass das Aufheben von `heikel` eine Begruendung braucht.
 *      `heikel` ist die Sperre, an der der Agent anhaelt (siehe
 *      api/vorgang/[id]/entwurf: bei heiklen Vorgaengen schreibt er
 *      keinen Entwurf vor). Wer sie wegnimmt, laesst die Automatik an
 *      eine Mahnung oder an Behoerdenpost heran. Setzen braucht dagegen
 *      keinen Grund -- Vorsicht erhoehen darf immer jeder sofort.
 *
 *   3. Welche Protokolleintraege faellig sind. Jede tatsaechliche
 *      Aenderung erzeugt genau einen Eintrag mit Vorher und Nachher.
 *      Nicht die Absicht wird vermerkt, sondern der Unterschied: Wer
 *      "offen" auf "offen" setzt, hat nichts geaendert, und ein Protokoll
 *      voller Nichtaenderungen ist nach einem Jahr unlesbar.
 */

/**
 * So lang muss die Begruendung fuer das Aufheben von `heikel` mindestens
 * sein. Zehn Zeichen sind kein Aufsatz, aber mehr als "ok" oder "nein" --
 * und sie verhindern vor allem das versehentliche Aufheben mit einem
 * Klick, denn ein Textfeld muss erst gefuellt werden.
 */
export const BEGRUENDUNG_MINDESTLAENGE = 10;

/**
 * So lang muss der Grund fuer "hier nicht antworten" mindestens sein.
 *
 * Dieselbe Zahl wie oben und derselbe Zweck: Ein Textfeld, das erst
 * gefuellt werden muss, verhindert das Schliessen mit einem Klick. Der
 * Grund ist hier aber nicht nur Dokumentation -- er ist die einzige
 * Auskunft darueber, was mit dieser Mail geschehen ist. "Erledigt" ohne
 * gesendete Antwort und ohne Grund sieht in einem Jahr wie ein
 * vergessener Vorgang aus.
 */
export const OHNE_ANTWORT_MINDESTLAENGE = 10;

/** Von welchem Status aus welcher erreichbar ist. */
export const STATUS_WEGE: Record<VorgangStatus, VorgangStatus[]> = {
  offen: ["wartet", "erledigt"],
  wartet: ["offen", "erledigt"],
  // Zurueck ins Leben geht nur ueber "offen", siehe Kopf dieser Datei.
  erledigt: ["offen"],
};

/** Welche Knoepfe die Oberflaeche anbieten darf. */
export function erlaubteStatus(ist: VorgangStatus): VorgangStatus[] {
  return STATUS_WEGE[ist] ?? [];
}

/**
 * Die Beschriftung des Knopfes, der zu diesem Status fuehrt.
 *
 * "Erledigt" und "Wartet" sagen, wo man landet; von "erledigt" zurueck
 * heisst nicht "Offen", sondern "Wieder oeffnen" -- der Unterschied ist
 * die Handlung, nicht der Zielzustand.
 */
export function statusKnopf(ist: VorgangStatus, ziel: VorgangStatus): string {
  if (ist === "erledigt" && ziel === "offen") return "Wieder öffnen";
  if (ziel === "erledigt") return "Erledigt";
  if (ziel === "wartet") return "Wartet";
  return STATUS_LABEL[ziel];
}

export type Ereignis =
  | "vorgang_status_geaendert"
  | "vorgang_kategorie_geaendert"
  | "vorgang_heikel_geaendert"
  | "vorgang_ohne_antwort_geschlossen";

/** Ein faelliger Protokolleintrag, fertig zum Schreiben. */
export interface ProtokollEintrag {
  ereignis: Ereignis;
  details: Record<string, unknown>;
}

/** Der Stand, wie er in der Datenbank steht. */
export interface Ist {
  status: VorgangStatus;
  kategorie: Kategorie;
  heikel: boolean;
  /**
   * Gesetzt, wenn der Vorgang ausdruecklich ohne Antwort geschlossen
   * wurde (db/031). Optional, weil die Spalte neu ist und jeder
   * Aufrufer, der sie nicht kennt, weiterhin uebersetzt.
   */
  ohne_antwort_grund?: string | null;
}

/**
 * Was aus dem Browser kommt. Bewusst `unknown`: Diese Werte sind
 * ungepruefte Eingabe, und die Pruefung ist genau die Aufgabe dieser
 * Datei. Ein `status?: VorgangStatus` in der Signatur waere ein
 * Versprechen, das der Aufrufer nicht halten kann.
 */
export interface Wunsch {
  status?: unknown;
  kategorie?: unknown;
  heikel?: unknown;
  begruendung?: unknown;
  /**
   * Der Grund, aus dem hier nicht geantwortet wird. Gesetzt heisst:
   * Vorgang schliessen, ohne zu antworten.
   */
  ohne_antwort?: unknown;
}

export type Pruefung =
  | { ok: true; soll: Ist; eintraege: ProtokollEintrag[] }
  | { ok: false; fehler: string; code: 400 | 409 };

const STATUS_WERTE = Object.keys(STATUS_LABEL) as VorgangStatus[];
const KATEGORIE_WERTE = Object.keys(KATEGORIE_LABEL) as Kategorie[];

export function istStatus(wert: unknown): wert is VorgangStatus {
  return typeof wert === "string" && (STATUS_WERTE as string[]).includes(wert);
}

export function istKategorie(wert: unknown): wert is Kategorie {
  return typeof wert === "string" && (KATEGORIE_WERTE as string[]).includes(wert);
}

const nein = (fehler: string, code: 400 | 409 = 400): Pruefung => ({
  ok: false,
  fehler,
  code,
});

/**
 * Prueft einen Aenderungswunsch und sagt, was zu schreiben ist.
 *
 * Felder, die der Wunsch nicht nennt, bleiben unberuehrt -- die
 * Oberflaeche schickt nur das, was ein Knopf gerade bedeutet, und nicht
 * den ganzen Vorgang. Ein mitgeschickter Wert, der dem heutigen gleicht,
 * ist keine Aenderung und erzeugt keinen Eintrag.
 *
 * `wer` steht in jedem Eintrag. Ohne den Namen ist ein Protokoll nur eine
 * Liste von Zustaenden, und genau die Frage, die spaeter gestellt wird --
 * wer hat das aufgehoben -- bliebe offen.
 */
export function pruefeAenderung(ist: Ist, wunsch: Wunsch, wer: string): Pruefung {
  const begruendung =
    typeof wunsch.begruendung === "string" ? wunsch.begruendung.trim() : "";
  const eintraege: ProtokollEintrag[] = [];
  const soll: Ist = { ...ist };

  // --- "Hier nicht antworten" -----------------------------------------
  //
  // Bisher gab es beantworten oder liegenlassen, und Liegenlassen sah aus
  // wie Arbeit, die noch wartet: Die Kennzahl "Wartet auf Freigabe"
  // (lib/kennzahlen.ts, ladeFreigabestand) zaehlte den Vorgang mit,
  // solange er auf "offen" stand. Eine Mail, auf die bewusst nicht
  // geantwortet wird, blieb damit fuer immer in der Liste der offenen
  // Faelle -- und eine Liste, in der die Haelfte nicht mehr gemeint ist,
  // wird nicht mehr gelesen.
  //
  // Bewusst KEIN vierter Status. Der Vorgang geht auf "erledigt" und
  // faellt damit aus jeder Zaehlung, die auf status = 'offen' prueft --
  // ohne dass eine einzige Abfrage angefasst werden muss. Was den Fall
  // von einem beantworteten unterscheidet, ist allein der Grund, und der
  // steht jetzt am Vorgang statt nur im Protokoll.
  if (wunsch.ohne_antwort !== undefined && wunsch.ohne_antwort !== null) {
    if (typeof wunsch.ohne_antwort !== "string") {
      return nein("Der Grund muss Text sein.");
    }
    const grund = wunsch.ohne_antwort.trim();
    if (grund.length < OHNE_ANTWORT_MINDESTLAENGE) {
      return nein(
        "Ohne Antwort schliessen braucht einen Grund von mindestens " +
          `${OHNE_ANTWORT_MINDESTLAENGE} Zeichen. In einem Jahr ist der ` +
          "Grund die einzige Auskunft darueber, was mit dieser Mail " +
          "geschehen ist.",
      );
    }
    // Ein gleichzeitig gesendeter, anderer Status waere ein Widerspruch
    // in derselben Anfrage. Dann lieber abweisen als eine der beiden
    // Absichten stillschweigend verwerfen.
    if (
      wunsch.status !== undefined &&
      wunsch.status !== null &&
      wunsch.status !== "erledigt"
    ) {
      return nein(
        "Ohne Antwort schliessen setzt den Vorgang auf „Erledigt“. Ein " +
          "anderer Status in derselben Anfrage widerspricht dem.",
        409,
      );
    }

    if (ist.status !== "erledigt") {
      soll.status = "erledigt";
      eintraege.push({
        ereignis: "vorgang_status_geaendert",
        details: {
          vorher: ist.status,
          nachher: "erledigt",
          wer,
          begruendung: grund,
          ohne_antwort: true,
        },
      });
    }
    if ((ist.ohne_antwort_grund ?? null) !== grund) {
      soll.ohne_antwort_grund = grund;
      eintraege.push({
        ereignis: "vorgang_ohne_antwort_geschlossen",
        details: {
          vorher: ist.ohne_antwort_grund ?? null,
          nachher: grund,
          wer,
          begruendung: grund,
        },
      });
    }
  }

  // --- Status ---------------------------------------------------------
  if (wunsch.status !== undefined && wunsch.status !== null) {
    if (!istStatus(wunsch.status)) {
      return nein(
        `Unbekannter Status. Möglich sind: ${STATUS_WERTE.join(", ")}.`,
      );
    }
    // soll.status statt ist.status: Hat der Block darueber schon auf
    // "erledigt" gesetzt, ist ein mitgeschicktes status="erledigt" keine
    // zweite Aenderung und darf keinen zweiten Protokolleintrag erzeugen.
    if (wunsch.status !== soll.status) {
      if (!erlaubteStatus(ist.status).includes(wunsch.status)) {
        return nein(
          `Von „${STATUS_LABEL[ist.status]}“ führt kein Weg direkt auf ` +
            `„${STATUS_LABEL[wunsch.status]}“. Einen erledigten Vorgang ` +
            "erst wieder öffnen — „wartet“ heißt, dass jemand draußen " +
            "antworten soll, und bei einem abgeschlossenen Vorgang wartet " +
            "niemand.",
          409,
        );
      }
      soll.status = wunsch.status;
      eintraege.push({
        ereignis: "vorgang_status_geaendert",
        details: {
          vorher: ist.status,
          nachher: wunsch.status,
          wer,
          ...(begruendung ? { begruendung } : {}),
        },
      });
    }
  }

  // --- Kategorie ------------------------------------------------------
  if (wunsch.kategorie !== undefined && wunsch.kategorie !== null) {
    if (!istKategorie(wunsch.kategorie)) {
      return nein(
        `Unbekannte Kategorie. Möglich sind: ${KATEGORIE_WERTE.join(", ")}.`,
      );
    }
    if (wunsch.kategorie !== ist.kategorie) {
      soll.kategorie = wunsch.kategorie;
      eintraege.push({
        ereignis: "vorgang_kategorie_geaendert",
        details: {
          vorher: ist.kategorie,
          nachher: wunsch.kategorie,
          wer,
          ...(begruendung ? { begruendung } : {}),
        },
      });
    }
  }

  // --- heikel ---------------------------------------------------------
  //
  // Bewusst getrennt von der Kategorie: Am 03.11.2026 lag eine Mail des
  // Messdienstleisters als "Behoerde/heikel" in der Akte, weil sie "Geben
  // Sie mir dazu noch Bescheid" enthielt. Die Kategorie zu berichtigen
  // nimmt die Sperre NICHT automatisch weg -- das waere ein stiller
  // Nebeneffekt einer harmlosen Korrektur. Wer die Sperre loesen will,
  // sagt das und begruendet es.
  if (wunsch.heikel !== undefined && wunsch.heikel !== null) {
    if (typeof wunsch.heikel !== "boolean") {
      return nein("heikel muss true oder false sein.");
    }
    if (wunsch.heikel !== ist.heikel) {
      if (ist.heikel && wunsch.heikel === false) {
        if (begruendung.length < BEGRUENDUNG_MINDESTLAENGE) {
          return nein(
            "Das Aufheben von „heikel“ braucht eine Begründung von " +
              `mindestens ${BEGRUENDUNG_MINDESTLAENGE} Zeichen. Danach ` +
              "darf der Agent hier wieder selbst Entwürfe schreiben — " +
              "wer das zulässt, hinterlässt den Grund.",
          );
        }
      }
      soll.heikel = wunsch.heikel;
      eintraege.push({
        ereignis: "vorgang_heikel_geaendert",
        details: {
          vorher: ist.heikel,
          nachher: wunsch.heikel,
          wer,
          // Beim Setzen gibt es keine Pflichtbegruendung, deshalb kann
          // hier null stehen. Der Schluessel fehlt aber nie: Ein
          // Protokoll, in dem das Feld manchmal da ist und manchmal
          // nicht, laesst sich nicht durchsuchen.
          begruendung: begruendung || null,
          // Festhalten, ob die Kategorie zu den von sich aus heiklen
          // gehoert (lib/typen.ts). Steht die Sperre spaeter zur
          // Diskussion, ist das die erste Frage.
          kategorie: soll.kategorie,
          kategorie_gilt_als_heikel: HEIKLE_KATEGORIEN.includes(soll.kategorie),
        },
      });
    }
  }

  if (eintraege.length === 0) {
    return nein(
      "Nichts zu ändern — die gesendeten Werte stehen schon so im Vorgang.",
    );
  }

  return { ok: true, soll, eintraege };
}

/**
 * Hebt dieser Wunsch die Sperre auf?
 *
 * Eigene Funktion, damit die Oberflaeche dieselbe Frage stellen kann wie
 * die Schnittstelle, ohne die Antwort nachzubauen: Nur dann verlangt das
 * Formular die Begruendung, und nur dann ist der zweite Schritt noetig.
 */
export function hebtSperreAuf(ist: Ist, wunsch: Wunsch): boolean {
  return ist.heikel === true && wunsch.heikel === false;
}

/**
 * Zaehlt dieser Vorgang noch als offener Fall?
 *
 * Eine Zeile, und trotzdem eine eigene Funktion mit eigenem Test. Der
 * Grund: Die Antwort steht an drei Stellen in SQL (lib/kennzahlen.ts,
 * lib/lagebericht.ts, components/FreigabeListe.tsx), und die Frage
 * "faellt ein ohne Antwort geschlossener Vorgang wirklich aus der
 * Zaehlung" soll sich an einem Ort beantworten lassen, ohne Postgres.
 *
 * Die Antwort lautet ja, und zwar ohne Zutun: Weil "ohne Antwort
 * schliessen" den Status auf "erledigt" setzt und nicht einen vierten
 * Status einfuehrt, greift jede bestehende Bedingung `status = 'offen'`
 * weiterhin richtig. Genau das war der Grund fuer diese Bauweise.
 */
export function zaehltAlsOffen(ist: Ist): boolean {
  return ist.status === "offen";
}

/** Wurde dieser Vorgang ausdruecklich ohne Antwort geschlossen? */
export function ohneAntwortGeschlossen(ist: Ist): boolean {
  return ist.status === "erledigt" && !!(ist.ohne_antwort_grund ?? "").trim();
}

/**
 * Teilt die Nachrichten einer Akte in "zu entscheiden" und "Verlauf".
 *
 * WARUM DAS EINE EIGENE FUNKTION IST (07.11.2026)
 *
 * Zwei Zeilen filter() -- aber die Teilung muss zwei Zusagen halten, die
 * man an zwei Zeilen in einer Seitenkomponente nicht pruefen kann:
 *
 *   1. Nichts geht verloren. Jede Nachricht steht in genau einem der
 *      beiden Teile.
 *   2. Nichts steht doppelt. Ein Entwurf, der oben zur Entscheidung
 *      steht, darf nicht zusaetzlich unten im Verlauf erscheinen --
 *      sonst stehen zwei Textfelder mit demselben Inhalt auf der Seite
 *      und es ist nicht zu sehen, welches gesendet wird.
 *
 * Die Reihenfolge innerhalb beider Teile bleibt die der Eingabe. Die
 * Akte sortiert nach angelegt_am; sortiert hier etwas um, stimmt der
 * Verlauf nicht mehr mit der Zeit.
 */
export function teileAkte<T extends { status: string }>(
  eintraege: readonly T[],
): { entwuerfe: T[]; verlauf: T[] } {
  const entwuerfe: T[] = [];
  const verlauf: T[] = [];
  for (const e of eintraege) {
    if (e.status === "entwurf") entwuerfe.push(e);
    else verlauf.push(e);
  }
  return { entwuerfe, verlauf };
}
