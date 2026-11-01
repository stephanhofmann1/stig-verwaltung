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
