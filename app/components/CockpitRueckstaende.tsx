import type { RueckstandsLage } from "@/lib/kennzahlen";
import {
  CockpitKarte,
  Erklaerung,
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
  gelesen,
}: {
  lage: RueckstandsLage;
  freigegeben: boolean;
  /**
   * Hat die Abfrage ueberhaupt geantwortet? Scheitert sie, liefert
   * ladeCockpit() LEER_RUECKSTAND -- lauter Nullen. Angezeigt hiesse das
   * "keine Rueckstaende", und das ist die gefaehrlichste Anzeige dieser
   * Seite: Sie beruhigt ueber Daten, die niemand gelesen hat.
   */
  gelesen: boolean;
}) {
  if (!gelesen) {
    return (
      <CockpitKarte titel="Rückstände" zaehler="nicht gelesen">
        <div className="leer">
          <strong>Die Rückstände konnten nicht ermittelt werden</strong>
          Solange die Abfrage nicht antwortet, ist über Summen und Fälle nichts
          bekannt — eine Null wäre hier die Behauptung, es stehe nichts aus.
          Der Grund steht oben auf der Seite.
        </div>
      </CockpitKarte>
    );
  }

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
      {/* Der Zustand selbst bleibt sichtbar: Eine Zahl wie "1.780 EUR
          Mahnung faellig" liest sich sonst, als waere das Schreiben schon
          unterwegs. Nur die Begruendung klappt zu. */}
      {freigegeben ? (
        <div className="meldung" data-art="info">
          <strong>Mahnwesen freigegeben — es entsteht trotzdem nur ein Entwurf</strong>
          <Erklaerung satz="Versendet wird über die Freigabe, nie von selbst">
            <p className="hinweis">
              Nachts erzeugt der Lauf das Schreiben als Entwurf. Raus geht es
              erst, wenn es oben in der Freigabe freigegeben wurde — daran
              ändert die Freigabe des Mahnwesens nichts.
            </p>
          </Erklaerung>
        </div>
      ) : (
        <div className="meldung" data-art="warnung">
          <strong>Es geht nichts raus — das Mahnwesen ist gesperrt</strong>
          <Erklaerung satz="Die Sperre liegt in der Datenbank, nicht in der Anzeige">
            <p className="hinweis">
              Solange die Freigabe in der Tabelle{" "}
              <code>mahnwesen_freigabe</code> fehlt, entsteht auch nachts kein
              Schreiben. Diese Zahlen sind der Stand, kein Schreiben.
            </p>
          </Erklaerung>
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
        <Erklaerung satz="Die ungeklärten Beträge gehören nicht in die Forderung — addiert ergäben sie einen Kündigungsgrund gegen pünktliche Altmieter">
          <p className="hinweis">
            Für diese Monate liegen keine Auszüge vor. Sie zur Forderung
            hinzuzuzählen wäre der Fehler, der nach § 543 Abs. 2 Nr. 3 BGB
            ausgerechnet denen eine Kündigung einbringt, die immer gezahlt
            haben. Was noch fehlt, bis eine Freigabe vertretbar ist, steht in
            der Bereitschaftsliste.{" "}
            <Verweis nach="/mahnwesen">Bereitschaftsliste</Verweis>
          </p>
        </Erklaerung>
      )}
    </CockpitKarte>
  );
}
