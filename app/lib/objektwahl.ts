/**
 * Die Objektwahl -- der Teil ohne Server.
 *
 * WARUM DAS EINE EIGENE DATEI IST
 *
 * Der Umschalter in der Kopfzeile (components/ObjektWahl.tsx) ist eine
 * Clientkomponente und braucht zwei Dinge von hier: den Wert fuer "alle
 * Objekte" und die Form einer Objektangabe. lib/objektsicht.ts kann er
 * dafuer nicht nehmen -- die Datei liest Cookies und die Datenbank, und
 * ein Import davon zoege next/headers und den Datenbankpool in den
 * Browserbau. Der Bau bricht daran ab, und zwar erst beim Bauen, nicht
 * beim Tippen.
 *
 * Also die Trennung nach dem, was eine Zeile braucht: Hier steht, was
 * ueberall gilt. In lib/objektsicht.ts steht, was eine Anfrage braucht.
 */

/** Der Name des Cookies. Kein Geheimnis, nur eine Vorliebe. */
export const KEKS_OBJEKT = "objekt";

/** Ein Jahr. Eine Sicht, die man taeglich neu waehlen muss, ist keine. */
export const KEKS_ALTER = 60 * 60 * 24 * 365;

/**
 * Der Wert, der "alle Objekte" bedeutet.
 *
 * Ein eigener Wert und nicht das Fehlen des Cookies: Wer bewusst auf die
 * Gesamtschau stellt, soll sie beim naechsten Aufruf wiederfinden. Ohne
 * ihn liesse sich die Gesamtschau nur durch Loeschen des Cookies
 * ausdruecken -- und dann saehe sie aus wie "noch nie gewaehlt".
 */
export const ALLE = "alle";

export interface ObjektAngabe {
  id: string;
  name: string;
}

/**
 * Welches Objekt gilt?
 *
 * Die ganze Entscheidung steht hier und nicht in der Komponente, damit
 * sie geprueft werden kann -- und weil sie einen Fall hat, den man beim
 * Hinschreiben uebersieht: Das Cookie ueberlebt den Mandantenwechsel.
 * Wer in der eGbR auf "Westanlage 9" steht und in den privaten Mandanten
 * wechselt, haette dort eine Kennung im Cookie, die es dort nicht gibt.
 * Ohne Pruefung filterte jede Abfrage auf ein fremdes Objekt, und das
 * Cockpit waere leer -- lauter Nullen, ohne Hinweis, warum.
 *
 * Darum: Was nicht in der Liste steht, ist die Gesamtschau.
 */
export function waehleObjekt(
  keks: string | null | undefined,
  vorhandene: readonly ObjektAngabe[],
): ObjektAngabe | null {
  if (!keks || keks === ALLE) return null;
  return vorhandene.find((o) => o.id === keks) ?? null;
}
