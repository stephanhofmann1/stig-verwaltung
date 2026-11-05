import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { query, one } from "./db";
import { ABLAGE } from "./belege";

/**
 * Anhänge an Nachrichten -- herein und hinaus.
 *
 * Der Anlass steht in db/032: Ein Entwurf an den Fensterbauer brauchte
 * sieben Fotos, und der Versandweg kannte keine Anhänge. In der
 * Gegenrichtung wurde alles weggeworfen, was nicht nach einer Rechnung
 * aussah.
 *
 * Hier stehen die Teile, die ohne Datenbank prüfbar sind, und das ist
 * Absicht -- es sind die, bei denen ein Fehler teuer wird:
 *
 *   mimeGroesse / pruefePaket  Passt das Paket durch? Gerechnet wird auf
 *                              der KODIERTEN Größe, nicht auf den rohen
 *                              Bytes. Siehe unten.
 *   auslieferung               Mit welchem Content-Type eine Datei den
 *                              Server verlässt. Hängt an der Richtung,
 *                              nicht am behaupteten Typ.
 *
 * Die Typprüfung selbst wird nicht neu geschrieben: erkenneTyp(),
 * pruefeDatei(), sichererDateiname() und ablagePfad() stehen in
 * lib/dokumente.ts und werden von dort benutzt. Geteilt wird der Code,
 * nicht die Tabelle.
 *
 * Tests in tests/anhaenge.test.ts.
 */

// ---------------------------------------------------------------------------
// Wie groß darf das Paket werden
// ---------------------------------------------------------------------------

/**
 * Die Grenze des GESAMTEN Pakets, gemessen an der kodierten Größe.
 *
 * 20 MB, und die Zahl ist der kleinere Teil der Entscheidung. Der
 * wichtigere Teil ist, WORAUF sie sich bezieht.
 *
 * Eine Mail transportiert Binärdaten als Base64. Aus drei Bytes werden
 * vier Zeichen, dazu ein Zeilenumbruch alle 76 Zeichen: Was auf der
 * Platte 18 MB misst, wiegt auf der Leitung rund 24,7 MB. Die meisten
 * empfangenden Mailserver riegeln bei 25 MB ab -- gerechnet auf der
 * Leitung, nicht auf der Platte.
 *
 * Wer also die rohen Bytes gegen 25 MB prüft, lässt ein Paket durch, das
 * mit 34 MB ankommt und abgewiesen wird. Und das ist der teure Teil: Der
 * Versand hat dann aus Sicht der Anwendung geklappt. Der Entwurf steht
 * auf 'gesendet', in der Akte steht ein Datum, und die Mail ist nie
 * angekommen. Eine Unzustellbarkeitsnachricht landet im Postfach des
 * Absenders, nicht in diesem Portal.
 *
 * Darum: Gerechnet wird kodiert, und die Grenze liegt mit 20 MB spürbar
 * unter den 25 MB der Gegenstelle. Die Lücke ist für die Kopfzeilen, den
 * Text und die MIME-Rahmen, die auch noch mitfahren.
 */
export const GRENZE_PAKET_BYTES = 20 * 1024 * 1024;

/**
 * Höchstens zwanzig Dateien an einer Mail.
 *
 * Keine technische Grenze, eine fachliche: Wer zwanzig Dateien anhängt,
 * meint ein Archiv und keine Nachricht. Spamfilter sehen das genauso.
 */
export const MAX_ANHAENGE = 20;

/** Die Länge der Base64-Kodierung von n Bytes, mit Auffüllung. */
export function base64Groesse(bytes: number): number {
  if (bytes <= 0) return 0;
  return 4 * Math.ceil(bytes / 3);
}

/**
 * Was eine Datei in der Mail wiegt.
 *
 * Base64 plus die Zeilenumbrüche: RFC 2045 schreibt höchstens 76 Zeichen
 * je Zeile vor, jede Zeile endet mit CRLF. Das sind noch einmal gut 2,6
 * Prozent, die in keiner Überschlagsrechnung vorkommen und genau dann
 * fehlen, wenn ein Paket knapp unter der Grenze liegt.
 */
export function mimeGroesse(bytes: number): number {
  const b64 = base64Groesse(bytes);
  if (b64 === 0) return 0;
  return b64 + Math.ceil(b64 / 76) * 2;
}

export type PaketPruefung =
  | { ok: true; kodiert: number }
  | { ok: false; kodiert: number; fehler: string };

/**
 * Passt dieses Paket durch?
 *
 * Nimmt die rohen Größen und antwortet auf der kodierten. Die Meldung
 * nennt beide Zahlen -- wer nur "zu groß" liest und auf der Platte 15 MB
 * sieht, hält die Prüfung für kaputt.
 */
export function pruefePaket(groessen: number[]): PaketPruefung {
  const kodiert = groessen.reduce((s, g) => s + mimeGroesse(g), 0);

  if (groessen.length > MAX_ANHAENGE) {
    return {
      ok: false,
      kodiert,
      fehler:
        `${groessen.length} Anhänge sind zu viele. Höchstens ` +
        `${MAX_ANHAENGE} an einer Nachricht.`,
    };
  }

  if (kodiert > GRENZE_PAKET_BYTES) {
    const roh = groessen.reduce((s, g) => s + g, 0);
    return {
      ok: false,
      kodiert,
      fehler:
        `Die Anhänge wiegen in der Mail ${mb(kodiert)} MB ` +
        `(auf der Platte ${mb(roh)} MB; Base64 macht aus drei Bytes vier ` +
        `Zeichen). Mehr als ${mb(GRENZE_PAKET_BYTES)} MB nehmen viele ` +
        `Empfänger nicht an.`,
    };
  }

  return { ok: true, kodiert };
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

// ---------------------------------------------------------------------------
// Wie eine Datei den Server verlässt
// ---------------------------------------------------------------------------

export type Richtung = "eingehend" | "ausgehend";

/**
 * Bilder und PDF darf der Browser selbst anzeigen -- aber nur die, deren
 * Typ wir am Inhalt bestimmt haben.
 */
const ANZEIGBAR = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
]);

export interface Auslieferung {
  contentType: string;
  /** 'inline' oder 'attachment' für den Content-Disposition-Header. */
  disposition: "inline" | "attachment";
}

/**
 * Mit welchem Typ eine Datei ausgeliefert wird.
 *
 * Die Richtung entscheidet, nicht der gespeicherte MIME-Typ:
 *
 *   ausgehend  Hier hochgeladen, Typ am Inhalt bestimmt (erkenneTyp).
 *              Dem dürfen wir glauben, es ist unsere eigene Feststellung.
 *
 *   eingehend  Kam von außen. Der MIME-Typ ist die BEHAUPTUNG des
 *              Absenders und sonst nichts. Wer ihn übernimmt, lässt einen
 *              Fremden bestimmen, was der Browser mit der Datei tut --
 *              eine als 'text/html' deklarierte Datei wird dann im
 *              Ursprung dieser Anwendung gerendert, mitsamt allem, was
 *              darin an Skript steht. Deshalb: immer
 *              application/octet-stream und immer zum Herunterladen.
 *              Das ist unbequem und bleibt so; der Anhang eines Fremden
 *              ist kein Inhalt dieser Seite.
 */
export function auslieferung(a: {
  richtung: Richtung;
  mime_typ: string | null;
}): Auslieferung {
  if (a.richtung !== "ausgehend") {
    return { contentType: "application/octet-stream", disposition: "attachment" };
  }
  const mime = a.mime_typ ?? "";
  if (ANZEIGBAR.has(mime)) {
    return { contentType: mime, disposition: "inline" };
  }
  return { contentType: "application/octet-stream", disposition: "attachment" };
}

/**
 * Die Kopfzeilen einer Dateiauslieferung.
 *
 * Stand bis zum 05.11.2026 in api/anhang/[id]/route.ts. Seit es einen
 * zweiten Weg gibt, über den Dateien aus dieser Anwendung hinausgehen
 * (api/belege/[id]/datei), steht sie hier: Eine Sicherungsregel, die an
 * zwei Stellen gepflegt wird, ist nach der ersten Änderung zwei
 * verschiedene Regeln -- und die schwächere entscheidet.
 *
 * nosniff ist dabei das Wichtigste: Was als application/octet-stream
 * hinausgeht, darf der Browser nicht selbst als HTML deuten und im
 * Ursprung dieser Anwendung ausführen.
 *
 * sandbox und default-src 'none' decken den zweiten Weg ab: Ein PDF darf
 * Javascript enthalten, und PDFs liefern wir inline aus.
 *
 * Der Dateiname steht zweimal im Header -- einmal auf ASCII reduziert für
 * alte Browser, einmal nach RFC 5987 für die Umlaute. Anführungszeichen
 * und Rückschrägstriche fallen aus der schlichten Fassung heraus, weil
 * sie den Header sonst beenden würden.
 */
export function kopfzeilen(
  contentType: string,
  disposition: "inline" | "attachment",
  dateiname: string,
  laenge: number,
): Record<string, string> {
  const schlicht = dateiname
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "");
  return {
    "Content-Type": contentType,
    "Content-Length": String(laenge),
    "Content-Disposition":
      `${disposition}; filename="${schlicht}"; ` +
      `filename*=UTF-8''${encodeURIComponent(dateiname)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, private",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}

/**
 * HEIC ist bei Empfängern ein Problem.
 *
 * Die Kamera des iPhones liefert HEIC, und Outlook unter Windows zeigt
 * davon nichts an. Wer einem Handwerker sieben HEIC-Bilder schickt,
 * schickt ihm sieben Dateien, die er nicht öffnen kann -- und erfährt es
 * nicht, weil die Mail zugestellt wurde.
 *
 * Umgewandelt wird hier (noch) nicht; die Oberfläche warnt. Lieber eine
 * sichtbare Warnung als eine stille Umwandlung, bei der am Ende niemand
 * weiß, welches Bild der Empfänger gesehen hat.
 */
export function heikleTypen(mimes: (string | null)[]): string[] {
  return [...new Set(mimes.filter((m): m is string => m === "image/heic"))];
}

/**
 * Die Endung, unter der eine Datei auf der Platte liegt.
 *
 * Zuerst wird der Inhalt befragt (erkenneTyp). Nur wenn der nichts
 * hergibt -- und bei eingehender Post ist das der Normalfall, da kommen
 * Office-Dateien, Archive, Kalendereinträge -- wird aus dem Namen eine
 * Endung abgeleitet.
 *
 * Und zwar sehr streng. Der Name kommt aus einer Mail von außen; er ist
 * Text, kein Pfad. "rechnung.pdf/../../../etc/cron.d/x" ist ein gültiger
 * Wert in einem MIME-Header. Deshalb bleiben nur Kleinbuchstaben und
 * Ziffern übrig, höchstens acht davon, und wenn danach nichts mehr da
 * ist, heißt die Datei '.bin'.
 *
 * Die Endung bestimmt NICHT, wie die Datei ausgeliefert wird -- das
 * entscheidet auslieferung() an der Richtung. Sie ist nur dafür da, dass
 * eine Datei auf der Platte wiedererkennbar bleibt, wenn jemand dort
 * einmal von Hand nachsieht.
 */
export function endungFuerAblage(
  erkannt: { endung: string } | null,
  dateiname: string,
): string {
  if (erkannt) return erkannt.endung;

  const roh = String(dateiname ?? "")
    .split(/[/\\]/)
    .pop() as string;
  const treffer = roh.match(/\.([A-Za-z0-9]{1,8})$/);
  if (!treffer) return ".bin";

  const sauber = treffer[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  return sauber === "" ? ".bin" : `.${sauber}`;
}

// ---------------------------------------------------------------------------
// Was der Versandweg bekommt
// ---------------------------------------------------------------------------

export interface AnhangNutzlast {
  dateiname: string;
  inhalt: Buffer;
}

/**
 * Die beiden Versandwege brauchen dieselben Dateien in verschiedener Form:
 * Resend will Base64 in JSON, nodemailer will den Puffer.
 *
 * Dass es dafür zwei Funktionen DIREKT NEBENEINANDER gibt, ist der Punkt.
 * Vorher hatte lib/versand.ts zwei getrennte Zweige, einen für Resend und
 * einen für SMTP, und was in dem einen stand, stand im anderen nicht
 * zwingend. Genau so entsteht der Fehler, den man nie bemerkt: Anhänge in
 * den Resend-Zweig einbauen, den SMTP-Zweig vergessen -- und sobald
 * jemand auf SMTP ausweicht, gehen Mails ohne Anhänge hinaus und melden
 * Erfolg.
 *
 * Die beiden Funktionen haben dieselbe Quelle und werden im Test
 * gegeneinander geprüft (tests/anhaenge.test.ts: gleiche Anzahl, gleiche
 * Namen, gleiche Bytes nach dem Dekodieren). Wer eine ändert und die
 * andere nicht, bekommt es gesagt.
 */
export function alsResendAnhaenge(
  anhaenge: AnhangNutzlast[],
): { filename: string; content: string }[] {
  return anhaenge.map((a) => ({
    filename: a.dateiname,
    content: a.inhalt.toString("base64"),
  }));
}

export function alsSmtpAnhaenge(
  anhaenge: AnhangNutzlast[],
): { filename: string; content: Buffer }[] {
  return anhaenge.map((a) => ({
    filename: a.dateiname,
    content: a.inhalt,
  }));
}

// ---------------------------------------------------------------------------
// Ablage und Datenbank
// ---------------------------------------------------------------------------

export const ABLAGE_ANHAENGE = join(ABLAGE, "anhaenge");

export interface AnhangZeile {
  id: string;
  nachricht_id: string;
  dateiname: string;
  mime_typ: string | null;
  richtung: Richtung;
  groesse_bytes: number;
  beleg_id: string | null;
  angelegt_am: string;
}

const SPALTEN = `id, nachricht_id, dateiname, mime_typ, richtung,
                 groesse_bytes, beleg_id, angelegt_am`;

export async function anhaengeZu(nachrichtId: string): Promise<AnhangZeile[]> {
  return query<AnhangZeile>(
    `SELECT ${SPALTEN} FROM nachricht_anhang
      WHERE nachricht_id = $1
      ORDER BY angelegt_am, dateiname`,
    [nachrichtId],
  );
}

/** Mehrere Nachrichten auf einmal -- für die Vorgangsakte. */
export async function anhaengeZuMehreren(
  nachrichtIds: string[],
): Promise<Map<string, AnhangZeile[]>> {
  const karte = new Map<string, AnhangZeile[]>();
  if (nachrichtIds.length === 0) return karte;
  const zeilen = await query<AnhangZeile>(
    `SELECT ${SPALTEN} FROM nachricht_anhang
      WHERE nachricht_id = ANY($1::uuid[])
      ORDER BY angelegt_am, dateiname`,
    [nachrichtIds],
  );
  for (const z of zeilen) {
    const liste = karte.get(z.nachricht_id) ?? [];
    liste.push(z);
    karte.set(z.nachricht_id, liste);
  }
  return karte;
}

export async function anhangMitPfad(
  id: string,
): Promise<(AnhangZeile & { ablage_pfad: string }) | null> {
  return one<AnhangZeile & { ablage_pfad: string }>(
    `SELECT ${SPALTEN}, ablage_pfad FROM nachricht_anhang WHERE id = $1`,
    [id],
  );
}

/**
 * Legt eine Datei ab und hängt sie an eine Nachricht.
 *
 * Der Name auf der Platte ist der Inhaltshash -- dasselbe Muster wie in
 * lib/dokumente.ts und lib/belege.ts. Dieselbe Datei an zwei Nachrichten
 * liegt damit einmal, und genau deshalb darf beim Entfernen die Datei
 * erst weg, wenn keine Zeile mehr auf sie zeigt (siehe entferne()).
 *
 * Gibt null zurück, wenn die Zeile schon da war (ON CONFLICT). Das ist
 * kein Fehler: Ein doppelt zugestellter Webhook und ein doppelter Klick
 * auf "Hochladen" sehen von hier aus gleich aus, und in beiden Fällen
 * ist der gewünschte Zustand bereits erreicht.
 */
export async function speichereAnhang(e: {
  nachrichtId: string;
  dateiname: string;
  inhalt: Uint8Array;
  mime: string | null;
  endung: string;
  richtung: Richtung;
  belegId?: string | null;
}): Promise<{ id: string; ablage_pfad: string } | null> {
  const daten = Buffer.from(e.inhalt);
  const hash = createHash("sha256").update(daten).digest("hex").slice(0, 24);
  const monat = new Date().toISOString().slice(0, 7);
  const pfad = join(ABLAGE_ANHAENGE, monat, `${hash}${e.endung}`);

  await mkdir(join(ABLAGE_ANHAENGE, monat), { recursive: true });
  await writeFile(pfad, daten);

  const zeilen = await query<{ id: string }>(
    `INSERT INTO nachricht_anhang
       (nachricht_id, dateiname, mime_typ, richtung, groesse_bytes,
        ablage_pfad, beleg_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (mandant_id, nachricht_id, ablage_pfad) DO NOTHING
     RETURNING id`,
    [
      e.nachrichtId,
      e.dateiname,
      e.mime,
      e.richtung,
      daten.length,
      pfad,
      e.belegId ?? null,
    ],
  );

  if (zeilen.length === 0) return null;
  return { id: zeilen[0].id, ablage_pfad: pfad };
}

export async function leseInhalt(pfad: string): Promise<Buffer> {
  return readFile(pfad);
}

/**
 * Entfernt einen Anhang.
 *
 * Erst die Zeile, dann die Datei -- und die nur, wenn keine andere Zeile
 * mehr auf denselben Pfad zeigt. Dieselbe Überlegung wie bei
 * dokumente.loesche(): Weil der Dateiname der Inhaltshash ist, teilen
 * sich gleiche Dateien einen Pfad, und wer blind löscht, nimmt einem
 * anderen Anhang die Datei weg.
 *
 * Scheitert das Entfernen der Datei, bleibt es dabei: Zeile weg, Datei
 * liegt. Der umgekehrte Ausgang -- Datei weg, Zeile da -- wäre ein
 * Anhang, den die Oberfläche anzeigt und der beim Anklicken einen Fehler
 * wirft.
 */
export async function entferne(id: string): Promise<boolean> {
  const zeile = await one<{ ablage_pfad: string }>(
    `SELECT ablage_pfad FROM nachricht_anhang WHERE id = $1`,
    [id],
  );
  if (!zeile) return false;

  const weg = await query<{ id: string }>(
    `DELETE FROM nachricht_anhang WHERE id = $1 RETURNING id`,
    [id],
  );
  if (weg.length === 0) return false;

  const nochDa = await query<{ eins: number }>(
    `SELECT 1 AS eins FROM nachricht_anhang WHERE ablage_pfad = $1 LIMIT 1`,
    [zeile.ablage_pfad],
  );
  if (nochDa.length === 0) {
    try {
      await unlink(zeile.ablage_pfad);
    } catch (e) {
      console.error("[anhang-datei]", zeile.ablage_pfad, e);
    }
  }
  return true;
}
