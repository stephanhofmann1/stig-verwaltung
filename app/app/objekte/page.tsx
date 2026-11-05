import Link from "next/link";
import { tag } from "@/lib/formate";
import { objektUebersicht } from "@/lib/objekte";

export const dynamic = "force-dynamic";

/**
 * Die Objektuebersicht -- die Seite, die es nicht gab.
 *
 * Die Objektseite /objekt/[id] enthaelt genau das, was ein Vermieter
 * zuerst wissen will, war aber nur ueber Umwege erreichbar: Stammdaten ->
 * eine Einheit suchen -> Einheit oeffnen -> Objektnamen anklicken. Wer drei
 * Haeuser hat, braucht dafuer vier Klicks je Haus und muss den Namen einer
 * Einheit kennen, um an das Haus zu kommen.
 *
 * Hier stehen alle Objekte nebeneinander, mit denselben Zahlen wie die
 * Objektseite -- sie kommen aus derselben Ableitung in lib/objekte.ts.
 * Gerechnet wird nicht hier: Zwei Rechnungen fuer eine Zahl laufen
 * auseinander, und beim Wort "Leerstand" ist das in dieser Anwendung schon
 * passiert.
 *
 * Jede Zeile hat genau ein Ziel, traegt den Weg also ganz -- auf dem
 * Telefon ist das eine Flaeche statt eines Wortes.
 */

const euro = (betrag: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(betrag);

const euroGenau = (betrag: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(betrag);

const qm = (wert: number) =>
  `${wert.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`;

export default async function Objektuebersicht() {
  const objekte = await objektUebersicht();

  const sollGesamt = objekte.reduce((s, o) => s + o.zahlen.sollMonat, 0);
  const kaltGesamt = objekte.reduce((s, o) => s + o.zahlen.sollMonatKalt, 0);
  const bkGesamt = objekte.reduce(
    (s, o) => s + o.zahlen.sollMonatNebenkosten,
    0,
  );
  const ohneGesamt = objekte.reduce(
    (s, o) => s + o.zahlen.sollMonatOhneAufteilung,
    0,
  );
  const freiGesamt = objekte.reduce(
    (s, o) => s + o.zahlen.angebotenFrei.length,
    0,
  );

  return (
    <>
      <div className="titelzeile">
        <h1>Objekte</h1>
        <span className="zaehler ziffern">
          {objekte.length === 1 ? "1 Objekt" : `${objekte.length} Objekte`}
        </span>
      </div>
      <p className="hinweis">
        Ein Haus je Zeile, mit dem Soll des laufenden Monats, der Belegung
        und der Fläche. Die Zeile führt ins Objekt — dort stehen die
        Einheiten einzeln und die Hausdokumente.
      </p>

      {objekte.length === 0 ? (
        <div className="leer">
          <strong>Noch kein Objekt erfasst</strong>
          Ohne Objekt gibt es keine Einheiten und keine Sollstellung.
        </div>
      ) : (
        <>
          <div className="karten">
            <div className="karte">
              <div className="kennzahl">
                <span className="kennzahl-schild">Soll je Monat (warm)</span>
                <span className="kennzahl-wert ziffern">
                  {euroGenau(sollGesamt)}
                </span>
                <span className="erklaerung ziffern">
                  Kalt {euroGenau(kaltGesamt)} · BK {euroGenau(bkGesamt)}
                  {ohneGesamt !== 0 && (
                    <> · ohne Aufteilung {euroGenau(ohneGesamt)}</>
                  )}
                </span>
                <span className="erklaerung">
                  Summe aller laufenden Mietverhältnisse, zum heute
                  gültigen Preis.{" "}
                  {ohneGesamt !== 0 &&
                    "„Ohne Aufteilung“ sind Inklusivmieten und Möblierungszuschläge — sie haben keine vereinbarte Kaltmiete und dürfen nicht als eine gelesen werden."}
                </span>
              </div>
            </div>
            <div className="karte">
              <div className="kennzahl">
                <span className="kennzahl-schild">
                  Frei und angeboten
                </span>
                <span
                  className="kennzahl-wert ziffern"
                  data-art={freiGesamt > 0 ? "warn" : "gut"}
                >
                  {freiGesamt}
                </span>
                <span className="erklaerung">
                  Nur vermarktbare Einheiten: ohne Gemeinschaftsflächen,
                  ohne &bdquo;nicht anbieten&ldquo;, ohne Einheiten im Bau.
                </span>
              </div>
            </div>
          </div>

          <div className="register">
            {objekte.map((o) => {
              const z = o.zahlen;
              return (
                <Link href={`/objekt/${o.id}`} className="posten" key={o.id}>
                  <span className="nummer ziffern">{z.einzeln}</span>
                  <span className="betreff">{o.name}</span>
                  <span className="zeit ziffern">
                    {z.sollMonat > 0 ? euroGenau(z.sollMonat) : "—"}
                  </span>
                  <span className="unterzeile">
                    <span>
                      {o.strasse}, {o.plz} {o.ort}
                    </span>
                    <span className="ziffern">
                      {z.belegt} von {z.einzeln} Einheiten belegt
                    </span>
                    {/* Woraus das Soll besteht. Kalt und BK getrennt, und
                        was sich nicht aufteilen laesst als eigener Posten
                        -- Inklusivmieten und Moeblierungszuschlaege.
                        Dieselbe Trennung wie im Mietenbuch und auf der
                        Objektseite, aus derselben Ableitung; eine zweite
                        Rechnung derselben Zahl liefe davon weg. Kostet
                        keine zusaetzliche Abfrage: die Posten liegen in
                        objektKennzahlen() schon vor. */}
                    {z.sollMonat > 0 && (
                      <span className="ziffern">
                        Kalt {euroGenau(z.sollMonatKalt)} · BK{" "}
                        {euroGenau(z.sollMonatNebenkosten)}
                        {z.sollMonatOhneAufteilung !== 0 &&
                          ` · o. A. ${euroGenau(z.sollMonatOhneAufteilung)}`}
                      </span>
                    )}
                    {z.angebotenFrei.length > 0 ? (
                      <span className="marker" data-art="warn">
                        {z.angebotenFrei.length} frei und angeboten
                        {z.entgangeneAngebotsmiete > 0 &&
                          ` · ${euro(z.entgangeneAngebotsmiete)} Angebotsmiete je Monat`}
                      </span>
                    ) : (
                      <span>nichts frei und angeboten</span>
                    )}
                    {z.belegungOffen > 0 && (
                      <span className="marker">
                        {z.belegungOffen} × Belegung offen
                      </span>
                    )}
                    <span className="ziffern">
                      {z.flaeche > 0 ? qm(z.flaeche) : "keine Fläche erfasst"}
                      {z.flaeche > 0 &&
                        z.ohneFlaeche > 0 &&
                        ` (${z.ohneFlaeche} ohne Angabe)`}
                    </span>
                    {/* Ohne Kontodaten läuft für dieses Haus kein
                        Mahnwesen. Das gehört in die Übersicht, nicht erst
                        auf die Objektseite — es ist der Grund, warum ein
                        Rueckstand liegen bleibt. */}
                    {!o.zahlungsdaten_ab ? (
                      <span className="marker" data-art="heikel">
                        keine Kontodaten — hier wird nicht gemahnt
                      </span>
                    ) : (
                      <span>Kontodaten ab {tag(o.zahlungsdaten_ab)}</span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>

          <p className="erklaerung">
            <strong>Frei und angeboten</strong> zählt nur vermarktbare
            Einheiten: ohne Gemeinschaftsflächen, ohne die auf &bdquo;nicht
            anbieten&ldquo; gestellten Flächen und ohne Einheiten im Bau.
            Einheiten, deren Belegung nie gepflegt wurde, gelten als belegt
            und stehen getrennt als &bdquo;Belegung offen&ldquo; — lieber
            ein freies Zimmer nicht anbieten als ein bewohntes. Das Cockpit
            zählt unter &bdquo;Leerstand&ldquo; dieselben freien Einheiten,
            nimmt aber zusätzlich auf, was in den nächsten drei Monaten
            frei wird.
          </p>
        </>
      )}
    </>
  );
}
