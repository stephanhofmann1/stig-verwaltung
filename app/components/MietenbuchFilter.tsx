import Link from "next/link";
import {
  filterGesetzt,
  leererFilter,
  mietenbuchAdresse,
  ohneFeld,
  type Mietenbuchfilter,
} from "@/lib/mietenbuch";

/**
 * Die Filterleiste über dem Mietenbuch.
 *
 * Bei drei Häusern hat das Raster über fünfzig Zeilen. Wer wissen will, was
 * in einem Zimmer passiert ist, rollt sonst durch alles andere mit.
 *
 * Bewusst ein Formular mit `method="get"` und keine Bedienung im Browser:
 *
 *   - Der Ausschnitt steht in der Adresse. Ein Blick auf ein Haus oder auf
 *     "nur mit Abweichung" lässt sich weitergeben, speichern und ausdrucken
 *     -- genauso wie die Zeitraumwahl daneben, aus demselben Grund.
 *   - Es wird nicht je Tastendruck gefiltert und damit auch nicht je
 *     Tastendruck die Datenbank gefragt. Gefiltert wird einmal, beim
 *     Absenden, und zwar auf dem fertigen Raster (siehe `filterRaster` in
 *     lib/mietenbuch.ts).
 *   - Ohne JavaScript funktioniert es genauso.
 *
 * Die Gestaltung der Leiste kommt aus globals.css (.filterleiste,
 * .filterleiste-feld, .filter-marke, .filter-zurueck) -- hier stehen keine
 * Inline-Stile und in app/raster.css keine eigenen Regeln dafür.
 */

/** Was die gesetzten Filter als Marke anzeigen. */
interface Marke {
  feld: keyof Mietenbuchfilter;
  schild: string;
  wert: string;
}

const ART_SCHILD: Record<"wohnen" | "gewerbe", string> = {
  wohnen: "Wohnen",
  gewerbe: "Gewerbe",
};

const NUR_SCHILD: Record<"abweichung" | "leerstand", string> = {
  abweichung: "nur mit Abweichung",
  leerstand: "nur mit Leerstand",
};

export function MietenbuchFilter({
  filter,
  jahr,
  zeilen,
  gesamt,
}: {
  filter: Mietenbuchfilter;
  /** Das gewählte Kalenderjahr -- muss beim Filtern erhalten bleiben. */
  jahr: number | null;
  /** Sichtbare Einheitszeilen. */
  zeilen: number;
  /** Einheitszeilen ohne Filter. */
  gesamt: number;
}) {
  const gesetzt = filterGesetzt(filter);

  /*
    Das Haus steht NICHT mehr in dieser Leiste (geaendert 08.11.2026).

    Seit es den Objektumschalter im Kopf gibt (components/ObjektWahl.tsx),
    gab es zwei Stellen fuer dieselbe Entscheidung -- und beim Lesen einer
    Zahl waere nicht mehr zu sagen gewesen, welche davon gerade gilt.
    Stephan hat entschieden: Der Kopf steuert alles.

    Die Marke dazu entfaellt hier ebenfalls. Sie haette "Objekt entfernen"
    angeboten und damit etwas zurueckgenommen, was die Leiste gar nicht
    gesetzt hat.
  */
  const marken: Marke[] = [];
  if (filter.suche !== "") {
    marken.push({ feld: "suche", schild: "Suche", wert: filter.suche });
  }
  if (filter.art !== null) {
    marken.push({ feld: "art", schild: "Art", wert: ART_SCHILD[filter.art] });
  }
  if (filter.nur !== null) {
    marken.push({ feld: "nur", schild: "Nur", wert: NUR_SCHILD[filter.nur] });
  }

  return (
    <>
      {/* action auf die Seite selbst: Das Formular schreibt seine Felder als
          Suchparameter in die Adresse. Das Jahr steht nicht im Formular und
          würde dabei verlorengehen -- deshalb reist es als verstecktes Feld
          mit. Ohne das springt jeder Filter zurück auf die letzten zwölf
          Monate, und man filtert einen anderen Zeitraum als den, den man
          ansieht. */}
      <form method="get" action="/mietenbuch" className="filterleiste">
        {jahr !== null && <input type="hidden" name="jahr" value={jahr} />}

        <label className="filterleiste-feld">
          Suche
          <input
            type="search"
            name="suche"
            defaultValue={filter.suche}
            placeholder="Zimmer, Etage, WG oder Mieter"
            /* Kein autoFocus: Die Seite wird gelesen und nicht in erster
               Linie befüllt, und auf dem Telefon klappt sonst sofort die
               Tastatur über das Raster. */
            autoComplete="off"
          />
        </label>

        <label className="filterleiste-feld">
          Art
          <select name="art" defaultValue={filter.art ?? ""}>
            <option value="">Wohnen und Gewerbe</option>
            <option value="wohnen">nur Wohnen</option>
            <option value="gewerbe">nur Gewerbe</option>
          </select>
        </label>

        <label className="filterleiste-feld">
          Auffällig
          <select name="nur" defaultValue={filter.nur ?? ""}>
            <option value="">alle Zeilen</option>
            <option value="abweichung">nur mit Abweichung</option>
            <option value="leerstand">nur mit Leerstand</option>
          </select>
        </label>

        <div className="filterleiste-feld">
          <button type="submit">Ausschnitt zeigen</button>
        </div>
      </form>

      {gesetzt && (
        <p className="hinweis mb-voll">
          {marken.map((m) => (
            <Link
              key={m.feld}
              className="filter-marke"
              href={mietenbuchAdresse(ohneFeld(filter, m.feld), jahr)}
              aria-label={`Filter ${m.schild} „${m.wert}“ entfernen`}
              title={`Filter ${m.schild} entfernen`}
            >
              {m.schild}: {m.wert} <span aria-hidden="true">✕</span>
            </Link>
          ))}{" "}
          <span className="zaehler">
            {zeilen} von {gesamt}{" "}
            {gesamt === 1 ? "Einheit" : "Einheiten"} sichtbar
          </span>{" "}
          <Link
            className="filter-zurueck"
            href={mietenbuchAdresse(leererFilter(), jahr)}
          >
            Alle Einheiten zeigen
          </Link>
        </p>
      )}
    </>
  );
}
