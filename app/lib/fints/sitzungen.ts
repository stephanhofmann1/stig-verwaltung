import type { FinTSClient } from "lib-fints";

/**
 * Laufende FinTS-Dialoge, zwischen zwei Anfragen gehalten.
 *
 * Warum das nötig ist: Verlangt die Bank eine TAN, muss die Fortsetzung
 * (`...WithTan`) auf **demselben** Dialog passieren. Der Dialog steckt im
 * Client, und zwischen "TAN angefordert" und "TAN eingegeben" liegt ein
 * Mensch, der sein Handy sucht -- also mindestens eine weitere Anfrage.
 *
 * Deshalb im Arbeitsspeicher und nicht in der Datenbank: Ein Dialog hält
 * eine offene Verbindung und eine Sitzungskennung der Bank. Beides in die
 * Datenbank zu schreiben würde es nicht haltbarer machen, nur die
 * Sitzungskennung dauerhaft ablegen.
 *
 * Folge, die man wissen muss: Ein Neustart der Anwendung verwirft offene
 * TAN-Anforderungen. Dann fängt der Abruf von vorne an -- unschön, aber
 * harmlos, weil eine nicht abgeschlossene TAN keinen Fehlversuch zählt.
 *
 * Die Lebensdauer ist kurz. Eine TAN ist ohnehin nur Minuten gültig, und
 * ein Dialog, der stundenlang offen steht, hält bei der Bank eine Sitzung.
 */

interface Offen {
  client: FinTSClient;
  zugangId: string;
  /** Was die Bank anzeigt. */
  hinweis: string;
  /** Wofür die TAN gilt. */
  zweck: "synchronisieren" | "umsaetze";
  tanReferenz: string;
  angelegt: number;
}

const LEBENSDAUER_MS = 10 * 60 * 1000;

const offen = new Map<string, Offen>();

function aufraeumen(): void {
  const jetzt = Date.now();
  for (const [k, v] of offen)
    if (jetzt - v.angelegt > LEBENSDAUER_MS) offen.delete(k);
}

export function merke(
  schluessel: string,
  eintrag: Omit<Offen, "angelegt">,
): void {
  aufraeumen();
  offen.set(schluessel, { ...eintrag, angelegt: Date.now() });
}

export function hole(schluessel: string): Offen | null {
  aufraeumen();
  return offen.get(schluessel) ?? null;
}

export function vergiss(schluessel: string): void {
  offen.delete(schluessel);
}
