import { query } from "@/lib/db";
import { schluesselVorhanden } from "@/lib/fints/geheimnis";
import { BankAbruf } from "@/components/BankAbruf";
import { BankNeu } from "@/components/BankNeu";
import { BankZugangPflegen } from "@/components/BankZugangPflegen";
import { BankRuhen } from "@/components/BankRuhen";

export const dynamic = "force-dynamic";

/**
 * Die Bankanbindung.
 *
 * Hier wird ein Zugang eingerichtet, von Hand abgerufen und die TAN
 * eingegeben, die etwa alle 90 Tage fällig wird. Ohne diese Seite wäre die
 * Anbindung unbenutzbar: Der nächtliche Lauf kann keine TAN eingeben, und
 * der erste Abruf eines neuen Zugangs verlangt immer eine.
 */

interface Zeile {
  id: string;
  bezeichnung: string;
  konto: string;
  bank_id: string;
  benutzer: string;
  url: string;
  kunden_id: string | null;
  konto_iban: string | null;
  hat_pin: boolean;
  tan_faellig: boolean;
  tan_hinweis: string | null;
  letzter_fehler: string | null;
  letzter_abruf: string | null;
  letzter_erfolg: string | null;
  aktiv: boolean;
}

const datum = (iso: string | null) =>
  iso === null
    ? "noch nie"
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
      }).format(new Date(iso));

export default async function Bank() {
  const [zugaenge, konten] = await Promise.all([
    query<Zeile>(`
      SELECT z.id, z.bezeichnung, k.bezeichnung AS konto, z.bank_id, z.benutzer,
             z.url, z.kunden_id, z.konto_iban,
             (z.pin_verschluesselt IS NOT NULL) AS hat_pin,
             z.tan_faellig, z.tan_hinweis, z.letzter_fehler,
             z.letzter_abruf::text, z.letzter_erfolg::text, z.aktiv
        FROM fints_zugang z
        JOIN konto k ON k.id = z.konto_id
       ORDER BY z.bezeichnung
    `).catch(() => [] as Zeile[]),
    query<{ bezeichnung: string }>(
      `SELECT bezeichnung FROM konto WHERE art = 'bank' ORDER BY bezeichnung`,
    ).catch(() => []),
  ]);

  const schluessel = schluesselVorhanden();
  const produkt = Boolean(process.env.FINTS_PRODUKT_ID);

  return (
    <main>
      <div className="titelzeile">
        <h1>Bankanbindung</h1>
        <span className="zaehler">
          {zugaenge.length === 0 ? "nicht eingerichtet" : `${zugaenge.length} Zugänge`}
        </span>
      </div>

      {/* Hier stand bis zuletzt die Einrichtungsanleitung des Betreibers:
          die Namen der beiden Umgebungsvariablen FINTS_PRODUKT_ID und
          FINTS_SCHLUESSEL und der openssl-Befehl, mit dem der Schluessel
          erzeugt wird (64 Hexzeichen: `openssl rand -hex 32`). Das liest
          hier ein Vermieter, der nichts davon eintragen kann -- die
          Anleitung gehoert in die Betriebsdoku, der Hinweis in die
          Oberflaeche. Die Aussage bleibt: ohne diese zwei Angaben laeuft
          die Bankanbindung nicht, und eintragen muss sie die Technik.
          Der Kasten ist jetzt eine .meldung mit data-art="warnung" --
          dieselbe Creme-Flaeche mit braunem Balken, aber aus dem
          Stylesheet und damit auch im Dunkelmodus lesbar. */}
      {(!schluessel || !produkt) && (
        <div className="meldung" data-art="warnung">
          <strong>Noch nicht einsatzbereit</strong>
          {!produkt && (
            <>
              Es fehlt die Programmkennung, mit der sich diese Anwendung bei
              der Bank anmeldet. Seit dem 01.08.2019 lassen die Banken nur
              registrierte Programme zu; die Registrierung über fints.org ist
              derzeit kostenfrei. Die Kennung eines fremden Programms darf
              dafür nicht verwendet werden.
              <br />
            </>
          )}
          {!schluessel && (
            <>
              Es fehlt der Schlüssel, mit dem die Bank-PIN verschlüsselt
              wird. Ohne ihn wird keine PIN gespeichert.
              <br />
            </>
          )}
          Beides trägt ein, wer die Anwendung technisch betreut — in der
          Oberfläche lässt sich das nicht nachholen.
        </div>
      )}

      {zugaenge.length === 0 ? (
        <div className="leer">
          <strong>Kein Bankzugang eingerichtet</strong>
          Kontoumsätze kommen derzeit nur über den Dateiimport herein. Mit
          einem Zugang holt der nächtliche Lauf sie selbst — eine TAN ist
          dann etwa alle 90 Tage nötig.
        </div>
      ) : (
        <table className="liste">
          <tbody>
            {zugaenge.map((z) => (
              <tr key={z.id}>
                <td>
                  <strong>{z.bezeichnung}</strong>
                  <div className="hinweis">
                    {z.konto} · BLZ {z.bank_id} · Anmeldename {z.benutzer}
                  </div>

                  {!z.hat_pin && (
                    <div className="rueckmeldung" data-art="warn">
                      Keine PIN hinterlegt — es kann nichts abgerufen werden.
                    </div>
                  )}
                  {z.tan_faellig && (
                    <div className="rueckmeldung" data-art="warn">
                      <strong>TAN nötig, der nächtliche Abruf ruht.</strong>{" "}
                      {z.tan_hinweis}
                    </div>
                  )}
                  {z.letzter_fehler && (
                    <div className="rueckmeldung" data-art="fehler">
                      {z.letzter_fehler}
                    </div>
                  )}

                  <div className="hinweis">
                    Abgerufen bis {datum(z.letzter_abruf)}
                    {z.letzter_erfolg
                      ? ` · zuletzt erfolgreich am ${datum(z.letzter_erfolg)}`
                      : ""}
                  </div>

                  {z.hat_pin && z.aktiv && (
                    <BankAbruf zugang={z.id} name={z.bezeichnung} />
                  )}

                  {/*
                    Anhalten muss ohne Umweg über das Bearbeiten gehen.
                    Wer nicht weiß, woran ein Abruf scheitert, soll ihn
                    stoppen dürfen, bevor er es herausfindet -- drei
                    Fehlversuche sind bei den meisten Banken alles, was
                    man hat.
                  */}
                  <BankRuhen
                    id={z.id}
                    bezeichnung={z.bezeichnung}
                    ruht={!z.aktiv}
                  />

                  <BankZugangPflegen
                    id={z.id}
                    bezeichnung={z.bezeichnung}
                    benutzer={z.benutzer}
                    url={z.url}
                    kundenId={z.kunden_id}
                    kontoIban={z.konto_iban}
                    ruht={!z.aktiv}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="abschnitt">
        <BankNeu konten={konten.map((k) => k.bezeichnung)} />
      </div>

      {/* .abschnitt greift hier nicht: p.hinweis ist spezifischer und
          setzt margin per Kurzschreibweise, also auch margin-top: 0. Die
          Lesebreite bringt p.hinweis schon mit (62ch). */}
      <p className="hinweis">
        Der nächtliche Lauf holt nur den Zeitraum seit dem letzten Abruf,
        höchstens 85 Tage. Das ist der Grund, warum nicht jedes Mal eine TAN
        nötig ist: Wer „alles Verfügbare" abfragt oder mehr als 90 Tage,
        bekommt bei jeder Bank bei jedem Lauf eine TAN-Abfrage.
      </p>
    </main>
  );
}
