import { ladeCockpit } from "@/lib/kennzahlen";
import { CockpitFristen } from "@/components/CockpitFristen";
import { CockpitMonat } from "@/components/CockpitMonat";
import { CockpitRueckstaende } from "@/components/CockpitRueckstaende";
import { CockpitLeerstand } from "@/components/CockpitLeerstand";
import { CockpitCashflow } from "@/components/CockpitCashflow";
import { CockpitAutomatik } from "@/components/CockpitAutomatik";
import { CockpitZahlungen } from "@/components/CockpitZahlungen";
import { FreigabeListe } from "@/components/FreigabeListe";
import { Verweis, datum } from "@/components/CockpitKarte";

export const dynamic = "force-dynamic";

/**
 * Das Vermieter-Cockpit -- die Startseite.
 *
 * Eine Frage, in zehn Sekunden zu beantworten: Bleibt heute etwas liegen?
 * Die Karten stehen deshalb nach Dringlichkeit und nicht nach Themengebiet:
 *
 *   1. Fristen            verstreichen sie, ist Geld oder ein Recht weg
 *   2. Freigabe           was ohne einen Klick nicht rausgeht
 *   3. Laufender Monat    Soll, bezahlt, offen
 *   4. Rueckstaende       Summe und Anzahl; das Mahnwesen ist gesperrt
 *   5. Leerstand          frei und bald frei
 *   6. Cashflow           zwoelf Monate Ein und Aus
 *   7. Automatik          laeuft nachts noch, was nachts laufen soll
 *   8. Zahlungseingaenge  Geld, das da ist und nicht gezaehlt wird
 *
 * Bis zum 02.11.2026 war diese Seite allein die Freigabe-Warteschlange. Die
 * steckt jetzt unveraendert in components/FreigabeListe.tsx -- verloren ist
 * nichts, und es geht weiterhin nur raus, was dort freigegeben wird.
 *
 * Gerechnet wird hier nichts. Jede Zahl kommt aus lib/kennzahlen.ts, wo die
 * Rechnerei als reine Funktion steht und Tests hat. Der Grund ist derselbe
 * wie bei den Mahnstufen: Eine Zahl auf der Startseite wird geglaubt, ohne
 * dass jemand nachrechnet.
 */
export default async function Cockpit() {
  const d = await ladeCockpit();

  return (
    <>
      <div className="titelzeile">
        <h1>Cockpit</h1>
        <span className="zaehler">Stand {datum(d.heute)}</span>
      </div>

      {/* Fehlgeschlagene Abfragen werden genannt, nicht verschwiegen: Eine
          Karte, die still eine Null zeigt, weil ihre Abfrage geworfen hat,
          ist schlimmer als eine fehlende Karte. */}
      {d.fehler.length > 0 && (
        <div className="meldung" data-art="fehler">
          <strong>Diese Kennzahlen konnten nicht gelesen werden</strong>
          Sie stehen deshalb auf null und sind nicht zu glauben:{" "}
          {d.fehler.join(" · ")}
        </div>
      )}

      <CockpitFristen fristen={d.fristen} />

      <FreigabeListe />

      <CockpitMonat monat={d.monat.monat} geld={d.monat.geld} />

      <CockpitRueckstaende
        lage={d.rueckstaende}
        freigegeben={d.mahnwesenFreigegeben}
      />

      <CockpitLeerstand lage={d.leerstand} />

      <CockpitCashflow reihe={d.cashflow} />

      <CockpitAutomatik posten={d.automatik} lagebericht={d.lagebericht} />

      <CockpitZahlungen
        anzahl={d.unzugeordnet.anzahl}
        summe={d.unzugeordnet.summe}
      />

      <p className="hinweis">
        Weiter ins Detail: <Verweis nach="/mietenbuch">Mietenbuch</Verweis>{" "}
        <Verweis nach="/mahnwesen">Rückstände</Verweis>{" "}
        <Verweis nach="/belege">Belege</Verweis>{" "}
        <Verweis nach="/stammdaten">Stammdaten</Verweis>
      </p>
    </>
  );
}
