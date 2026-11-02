import type { RueckstandsLage } from "@/lib/kennzahlen";
import {
  CockpitKarte,
  Kennzahlen,
  Verweis,
  euroGenau,
} from "@/components/CockpitKarte";

/**
 * Rueckstaende, Summe und Anzahl -- und der Hinweis, dass nichts rausgeht.
 *
 * Die Sperre steht in der Datenbank (db/024, Tabelle mahnwesen_freigabe):
 * keine Zeile heisst gesperrt. Stephan hat am 01.11.2026 festgelegt, dass
 * das Mahnwesen erst auf sein Go live geht und vorher der Abgleich sauber
 * sein muss. Das Cockpit sagt das ausdruecklich, denn eine Zahl wie
 * "1.780 EUR Mahnung faellig" liest sich sonst, als waere das Schreiben
 * schon unterwegs.
 *
 * `summe` und `summeUngeklaert` werden nie addiert. Der ungeklaerte Teil
 * stammt aus Monaten ohne Kontoauszug; beides zusammenzuzaehlen gaebe jedem
 * uebernommenen Altmieter einen Kuendigungsgrund nach § 543 Abs. 2 Nr. 3
 * BGB -- ausgerechnet denen, die puenktlich zahlen.
 */
export function CockpitRueckstaende({
  lage,
  freigegeben,
}: {
  lage: RueckstandsLage;
  freigegeben: boolean;
}) {
  return (
    <CockpitKarte
      titel="Rückstände"
      zaehler={
        lage.zuSchreiben === 0 && lage.beobachten === 0
          ? "keine"
          : `${lage.zuSchreiben} zu schreiben`
      }
      mehr="/mahnwesen"
      mehrText="Rückstände und Bereitschaftsliste"
    >
      {freigegeben ? (
        <div className="meldung" data-art="info">
          <strong>Mahnwesen freigegeben</strong>
          Erzeugt wird trotzdem nur ein Entwurf — versendet wird über die
          Freigabe, nie von selbst.
        </div>
      ) : (
        <div className="meldung" data-art="warnung">
          <strong>Es geht nichts raus</strong>
          Das Mahnwesen ist in der Datenbank gesperrt — es fehlt die Freigabe
          in <code>mahnwesen_freigabe</code>, und eine fehlende Zeile heißt
          gesperrt. Diese Zahlen sind der Stand, kein Schreiben.
        </div>
      )}

      <Kennzahlen
        posten={[
          {
            begriff: "Mahnung oder Erinnerung fällig",
            wert: euroGenau(lage.summe),
            dazu: `${lage.zuSchreiben} ${
              lage.zuSchreiben === 1 ? "Mietverhältnis" : "Mietverhältnisse"
            }`,
            art: lage.zuSchreiben > 0 ? "fehl" : "gut",
          },
          {
            begriff: "unter der Schwelle",
            wert: euroGenau(lage.summeBeobachten),
            dazu: `${lage.beobachten} beobachten, kein Schreiben`,
            art: lage.beobachten > 0 ? "warn" : undefined,
          },
          {
            begriff: "ungeklärt",
            wert: euroGenau(lage.summeUngeklaert),
            dazu: `${lage.ungeklaert} ${
              lage.ungeklaert === 1 ? "Fall" : "Fälle"
            } ohne Kontodaten`,
          },
        ]}
      />

      {lage.summeUngeklaert > 0 && (
        <p className="hinweis">
          Die ungeklärten Beträge gehören nicht in die Forderung: Für diese
          Monate liegen keine Auszüge vor. Sie zu addieren wäre der Fehler, der
          pünktliche Altmieter in eine Kündigung treibt. Was noch fehlt, bis
          eine Freigabe vertretbar ist, steht in der Bereitschaftsliste.{" "}
          <Verweis nach="/mahnwesen">Bereitschaftsliste</Verweis>
        </p>
      )}
    </CockpitKarte>
  );
}
