import { LEER, STAND } from "@/components/MietenbuchRaster";
import type { LeerGrund, ZellStatus } from "@/lib/mietenbuch";

/**
 * Was die Zeichen im Raster bedeuten.
 *
 * Die Legende ist nicht Beiwerk. Zwei der sechs Zustände sehen auf einen
 * Blick nach Rückstand aus und sind keiner: "nicht abgeglichen" heisst, dass
 * für diesen Monat keine Kontoumsätze vorliegen, und "nicht erfasst" heisst,
 * dass die Belegung der Einheit nicht gepflegt ist. Wer das verwechselt,
 * mahnt die Falschen.
 */

const REIHENFOLGE: Array<Exclude<ZellStatus, "leer">> = [
  "bezahlt",
  "teilweise",
  "offen",
  "nicht_faellig",
  "nicht_abgeglichen",
];

const LEER_REIHENFOLGE: LeerGrund[] = [
  "frei",
  "eltern",
  "unbekannt",
  "nicht_vermietbar",
];

export function MietenbuchLegende() {
  return (
    <div className="karte">
      <p className="karte-titel">Zeichen im Raster</p>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(17rem, 1fr))",
          gap: "0.375rem 1.25rem",
          margin: 0,
          fontSize: "var(--text-m)",
        }}
      >
        {REIHENFOLGE.map((s) => {
          const k = STAND[s];
          return (
            <div key={s}>
              <dt style={{ display: "inline" }}>
                <span className="punkt" data-art={k.art} />
                <strong>
                  <span aria-hidden="true">{k.zeichen}</span> {k.kurz}
                </strong>
              </dt>{" "}
              <dd
                style={{
                  display: "inline",
                  margin: 0,
                  color: "var(--fg-leise)",
                }}
              >
                — {k.lang}
              </dd>
            </div>
          );
        })}
        {LEER_REIHENFOLGE.map((g) => {
          const k = LEER[g];
          return (
            <div key={g}>
              <dt style={{ display: "inline" }}>
                <span className="punkt" data-art={k.art} />
                <strong>
                  <span aria-hidden="true">{k.zeichen}</span> {k.kurz}
                </strong>
              </dt>{" "}
              <dd
                style={{
                  display: "inline",
                  margin: 0,
                  color: "var(--fg-leise)",
                }}
              >
                — {k.lang}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="hinweis" style={{ margin: "0.75rem 0 0", maxWidth: "none" }}>
        Beträge in Euro. Die <strong>Abweichung</strong> vergleicht nur Monate,
        die fällig sind <em>und</em> für die Kontoumsätze vorliegen. Ein{" "}
        <strong>*</strong> daneben heisst: In diesem Ausschnitt steht Soll, das
        bewusst nicht gegengerechnet wird — nicht abgeglichene und noch nicht
        fällige Monate. Die <strong>Leerstandsquote</strong> zählt nur Einheiten,
        die einzeln vermietet werden und deren Belegung gepflegt ist; ein Zimmer,
        das über den Vertrag seiner Etage belegt ist, ist kein Leerstand.
      </p>
    </div>
  );
}
