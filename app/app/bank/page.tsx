import { query } from "@/lib/db";
import { schluesselVorhanden } from "@/lib/fints/geheimnis";
import { BankAbruf } from "@/components/BankAbruf";
import { BankNeu } from "@/components/BankNeu";

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

      {(!schluessel || !produkt) && (
        <div className="leer" style={{ borderColor: "#8a5a00", background: "#fdf8ef" }}>
          <strong>Noch nicht einsatzbereit</strong>
          {!produkt && (
            <>
              Es fehlt <code>FINTS_PRODUKT_ID</code>. Seit dem 01.08.2019
              lassen die Banken nur registrierte Programme zu; die
              Registrierung über fints.org ist derzeit kostenfrei. Die Kennung
              einer fremden Programmbibliothek darf dafür nicht verwendet
              werden.
              <br />
            </>
          )}
          {!schluessel && (
            <>
              Es fehlt <code>FINTS_SCHLUESSEL</code> (genau 64 Hexzeichen,
              erzeugen mit <code>openssl rand -hex 32</code>). Ohne ihn wird
              keine PIN gespeichert.
            </>
          )}
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
                    <div style={{ color: "#8a5a00", marginTop: "0.3rem" }}>
                      Keine PIN hinterlegt — es kann nichts abgerufen werden.
                    </div>
                  )}
                  {z.tan_faellig && (
                    <div style={{ color: "#8a5a00", marginTop: "0.3rem" }}>
                      <strong>TAN nötig, der nächtliche Abruf ruht.</strong>{" "}
                      {z.tan_hinweis}
                    </div>
                  )}
                  {z.letzter_fehler && (
                    <div style={{ color: "#b3261e", marginTop: "0.3rem" }}>
                      {z.letzter_fehler}
                    </div>
                  )}

                  <div className="hinweis" style={{ marginTop: "0.3rem" }}>
                    Abgerufen bis {datum(z.letzter_abruf)}
                    {z.letzter_erfolg
                      ? ` · zuletzt erfolgreich am ${datum(z.letzter_erfolg)}`
                      : ""}
                  </div>

                  {z.hat_pin && z.aktiv && (
                    <BankAbruf zugang={z.id} name={z.bezeichnung} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: "2rem" }}>
        <BankNeu konten={konten.map((k) => k.bezeichnung)} />
      </div>

      <p className="hinweis" style={{ marginTop: "2rem", maxWidth: "40rem" }}>
        Der nächtliche Lauf holt nur den Zeitraum seit dem letzten Abruf,
        höchstens 85 Tage. Das ist der Grund, warum nicht jedes Mal eine TAN
        nötig ist: Wer „alles Verfügbare" abfragt oder mehr als 90 Tage,
        bekommt bei jeder Bank bei jedem Lauf eine TAN-Abfrage.
      </p>
    </main>
  );
}
