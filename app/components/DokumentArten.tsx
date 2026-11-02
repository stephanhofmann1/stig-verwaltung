/**
 * Die Angaben zu einem Dokument, wie die Oberfläche sie sieht.
 *
 * Bewusst eine eigene Datei: Die drei Bausteine daneben laufen im Browser
 * und dürfen lib/dokumente.ts nicht einbinden -- dort steht node:fs. Die
 * Liste der Arten wird deshalb hier wiederholt. Dass sie nicht auseinander
 * läuft, prüft tests/dokumente.test.ts.
 *
 * Nicht enthalten und nie enthalten: der Ablagepfad. Angesehen wird eine
 * Datei über /api/dokumente/<id>, und nur die Route kennt den Pfad.
 */

export interface DokAnzeige {
  id: string;
  art: string;
  bezeichnung: string | null;
  dateiname: string;
  mime_typ: string | null;
  groesse_bytes: string | null;
  mieter_sichtbar: boolean;
  angelegt_am: string;
}

export const ARTEN: { wert: string; label: string }[] = [
  { wert: "grundriss", label: "Grundriss" },
  { wert: "foto", label: "Foto" },
  { wert: "mietvertrag", label: "Mietvertrag" },
  { wert: "uebergabeprotokoll", label: "Übergabeprotokoll" },
  { wert: "energieausweis", label: "Energieausweis" },
  { wert: "sonstige", label: "Sonstiges" },
];

export const ART_TEXT: Record<string, string> = Object.fromEntries(
  ARTEN.map((a) => [a.wert, a.label]),
);

/** Kurzzeichen für die Laufnummernspalte der Register. */
export const ART_KURZ: Record<string, string> = {
  grundriss: "Plan",
  foto: "Foto",
  mietvertrag: "MV",
  uebergabeprotokoll: "Prot",
  energieausweis: "EA",
  sonstige: "Dok",
};

/** Die Adresse, unter der eine Datei ausgeliefert wird. */
export function dokumentUrl(id: string, herunterladen = false): string {
  return `/api/dokumente/${id}${herunterladen ? "?download=1" : ""}`;
}

export function istBildMime(mime: string | null): boolean {
  return (
    mime === "image/png" || mime === "image/jpeg" || mime === "image/heic"
  );
}

/** Dateigröße, kurz. */
export function groesse(bytes: string | null): string {
  const b = Number(bytes ?? 0);
  if (!Number.isFinite(b) || b <= 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Was über einem Dokument steht: die Bezeichnung, sonst der Dateiname. */
export function titel(d: DokAnzeige): string {
  return d.bezeichnung?.trim() || d.dateiname;
}
