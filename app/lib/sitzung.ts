import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";

/**
 * Sitzungscookie und Passwort-Hash — ohne Datenbank.
 *
 * Bewusst eine eigene Datei: proxy.ts prueft bei jeder Anfrage die Sitzung.
 * Wuerde es dafuer lib/anmeldung.ts einbinden, zoege es den Postgres-Treiber
 * und next/headers in den Proxy-Bundle. Hier steht nur Krypto.
 */

export const COOKIE = "stig_sitzung";
const GUELTIG_TAGE = 14;

export type Rolle = "verwalter" | "lesen" | "mieter";

export interface Sitzung {
  name: string;
  mandant: string;
  rolle: Rolle;
  /**
   * Nur bei rolle="mieter": an welchem Mietverhaeltnis der Zugang haengt.
   * Daraus leitet der Mieterbereich ab, was angezeigt werden darf -- die
   * Mandantentrennung allein genuegt dafuer nicht, sie trennt Vermieter
   * voneinander, nicht Mieter untereinander.
   */
  mietverhaeltnis?: string;
  /**
   * Der Mandant, in dem die Benutzerzeile steht -- der Heimatmandant.
   *
   * Er ist nicht dasselbe wie `mandant`: Nach einem Wechsel zeigt
   * `mandant` auf den Mandanten, in dem gerade gearbeitet wird, und
   * `heimat` darauf, wo das Konto hängt. Nur mit beiden lässt sich
   * später wieder prüfen, welche Mandanten diesem Konto offenstehen
   * (zugaenge_fuer in db/035) -- aus `mandant` allein liesse sich das
   * nicht ableiten, und genau das soll der Browser nicht bestimmen.
   *
   * Fehlt das Feld (Cookies von vor dem Umschalter), ist der
   * Heimatmandant der aktive. Das ist für einen Benutzer mit nur einem
   * Mandanten derselbe Wert, also kein Verlust.
   */
  heimat?: string;
}

function geheimnis(): string {
  const s = process.env.SITZUNG_GEHEIMNIS;
  if (!s || s.length < 32) {
    throw new Error(
      "SITZUNG_GEHEIMNIS fehlt oder ist zu kurz (mindestens 32 Zeichen).",
    );
  }
  return s;
}

/** Erzeugt einen Hash für ein Passwort. Aufruf über das Hilfsskript. */
export function hashe(passwort: string): string {
  const salz = randomBytes(16).toString("hex");
  const hash = scryptSync(passwort, salz, 64).toString("hex");
  return `scrypt$${salz}$${hash}`;
}

export function pruefePasswort(passwort: string, gespeichert: string): boolean {
  const teile = gespeichert.split("$");
  if (teile.length !== 3 || teile[0] !== "scrypt") return false;
  const [, salz, hash] = teile;
  const errechnet = scryptSync(passwort, salz, 64);
  const erwartet = Buffer.from(hash, "hex");
  if (errechnet.length !== erwartet.length) return false;
  return timingSafeEqual(errechnet, erwartet);
}

function signiere(nutzlast: string): string {
  return createHmac("sha256", geheimnis()).update(nutzlast).digest("base64url");
}

export function baueSitzung(s: Sitzung): string {
  // Mieterzugaenge sind kurzlebig: Der Bereich zeigt Mietvertragsdaten, und
  // ein neuer Link ist in zehn Sekunden angefordert. Vierzehn Tage waeren
  // hier kein Komfort, sondern ein offenes Fenster auf fremden Geraeten.
  const tage = s.rolle === "mieter" ? 1 : GUELTIG_TAGE;
  const ablauf = Date.now() + tage * 86_400_000;
  // Der Name darf kein Trennzeichen enthalten. Sonst verschiebt ein
  // Name wie "stephan|x|…" alle folgenden Felder und bestimmt damit
  // Werte, die er nicht bestimmen soll. Die Unterschrift würde stimmen --
  // sie deckt die Nutzlast, nicht ihre Bedeutung.
  if (s.name.includes("|")) {
    throw new Error("Ein Benutzername darf kein | enthalten.");
  }
  const nutzlast = [
    s.name,
    ablauf,
    s.mandant,
    s.rolle,
    s.mietverhaeltnis ?? "",
    s.heimat ?? "",
  ].join("|");
  return `${Buffer.from(nutzlast).toString("base64url")}.${signiere(nutzlast)}`;
}

export function pruefeSitzung(wert: string | undefined): Sitzung | null {
  if (!wert) return null;
  const punkt = wert.lastIndexOf(".");
  if (punkt < 1) return null;

  let nutzlast: string;
  try {
    nutzlast = Buffer.from(wert.slice(0, punkt), "base64url").toString();
  } catch {
    return null;
  }
  const unterschrift = wert.slice(punkt + 1);

  const erwartet = signiere(nutzlast);
  const a = Buffer.from(unterschrift);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [name, ablauf, mandant, rolle, mv, heimat] = nutzlast.split("|");
  if (!name || !ablauf || Number(ablauf) < Date.now()) return null;
  // Cookies aus der Zeit vor der Mandantentrennung haben die hinteren
  // Felder nicht. Die sind damit ungueltig — neu anmelden.
  if (!mandant || !rolle) return null;
  if (rolle !== "verwalter" && rolle !== "lesen" && rolle !== "mieter") return null;
  // Ein Mieterzugang ohne Mietverhaeltnis waere ein Zugang auf nichts --
  // oder, schlimmer, einer, bei dem irgendwo eine Pruefung ausfaellt.
  if (rolle === "mieter" && !mv) return null;

  // Ohne sechstes Feld ist der Heimatmandant der aktive -- so sahen alle
  // Cookies vor dem Umschalter aus.
  const daheim = heimat || mandant;
  return mv
    ? { name, mandant, rolle, mietverhaeltnis: mv, heimat: daheim }
    : { name, mandant, rolle, heimat: daheim };
}

export const COOKIE_NAME = COOKIE;
export const COOKIE_MAXALTER = GUELTIG_TAGE * 86_400;
