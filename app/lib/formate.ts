const ZEIT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TAG = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function zeitpunkt(wert: string | Date | null): string {
  if (!wert) return "—";
  return ZEIT.format(new Date(wert));
}

export function tag(wert: string | Date | null): string {
  if (!wert) return "—";
  return TAG.format(new Date(wert));
}

/** "vor 3 Stunden", "gestern", "vor 4 Tagen" — kurz, für Listen. */
export function seit(wert: string | Date | null): string {
  if (!wert) return "—";
  const dann = new Date(wert).getTime();
  const min = Math.round((Date.now() - dann) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.round(std / 24);
  if (tage === 1) return "gestern";
  if (tage < 30) return `vor ${tage} Tagen`;
  return TAG.format(new Date(wert));
}

export function aktenzeichen(nummer: number): string {
  return String(nummer).padStart(4, "0");
}

/**
 * Der deutsche Name eines naechtlichen Laufs.
 *
 * Die Kennung links ist der Wert in der Datenbank und im Zeitplaner -- sie
 * bleibt, wie sie ist, sonst findet der Lauf seine Zeile nicht mehr. Nur
 * angezeigt wird der Name rechts: "sollstellungen" sagt dem Vermieter
 * nichts darueber, dass dort die Mieten gestellt und die Zahlungen
 * zugeordnet werden.
 *
 * Stand bis zum 27.11.2026 nur in app/laeufe/page.tsx; das Cockpit zeigte
 * daneben die nackten Kennungen ("bankabruf", "agent").
 *
 * Eine unbekannte Kennung bleibt sichtbar, statt zu verschwinden: Kommt ein
 * neuer Lauf dazu, soll er in der Liste auftauchen -- und zwar auffaellig
 * genug, dass jemand ihm einen Namen gibt.
 */
const LAUF_NAMEN: Record<string, string> = {
  bankabruf: "Kontoabruf",
  mailabruf: "E-Mail-Abruf",
  agent: "Antwortentwürfe",
  nachfassen: "Nachfassen",
  sollstellungen: "Mieten stellen und zuordnen",
  lagebericht: "Lagebericht",
};

export function laufName(kennung: string): string {
  return LAUF_NAMEN[kennung] ?? kennung;
}
