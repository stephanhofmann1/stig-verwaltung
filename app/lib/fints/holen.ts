import { query, one, tx } from "../db";
import { entschluessele, schluesselVorhanden } from "./geheimnis";
import { alsBuchungen, bankMeldung, sollStilllegen, zeitraum,
         type AbrufErgebnis, type ZugangsDaten,
         type FintsUmsatz } from "./abruf";

/**
 * Holt die Umsätze eines FinTS-Zugangs und legt sie als Buchungen ab.
 *
 * Diese Datei ist die einzige, die mit der Bank spricht. Alles, was sich
 * ohne Bankverbindung prüfen lässt, steht in abruf.ts.
 *
 * Verhalten bei einer TAN-Anforderung: Der Zugang wird auf `tan_faellig`
 * gesetzt und ruht. Kein Wiederholen -- drei Versuche sperren den
 * Bankzugang, und ein Lauf, der es alle vier Stunden erneut probiert,
 * schafft das an einem Tag.
 */

/** Die Produktkennung, ohne die keine Bank mehr antwortet. */
function produkt(): { id: string; version: string } {
  const id = process.env.FINTS_PRODUKT_ID;
  if (!id) {
    throw new Error(
      "FINTS_PRODUKT_ID fehlt. Seit 01.08.2019 lassen die Banken nur " +
        "registrierte Produkte zu. Registrierung (derzeit kostenfrei) " +
        "über fints.org. Die Kennung einer fremden Programmbibliothek " +
        "darf dafür nicht verwendet werden -- sie ist nur zum Testen " +
        "freigegeben.",
    );
  }
  return { id, version: process.env.FINTS_PRODUKT_VERSION ?? "1.0" };
}

export async function zugaenge(): Promise<ZugangsDaten[]> {
  return query<ZugangsDaten>(`
    SELECT id, bezeichnung, bank_id, url, benutzer, kunden_id, konto_iban,
           tan_verfahren, tan_medium, bank_information,
           letzter_abruf::text
      FROM fints_zugang
     WHERE aktiv = true AND tan_faellig = false
     ORDER BY bezeichnung
  `);
}

/**
 * Ein Zugang, einmal abgerufen.
 *
 * Schreibt `letzter_abruf` **nur** nach einem erfolgreichen Abruf. Würde es
 * auch bei einem Fehler gesetzt, wäre der übersprungene Zeitraum für immer
 * verloren: Der nächste Lauf fängt dann hinter der Lücke an, und die
 * fehlenden Zahlungen sehen aus wie Rückstände.
 */
export async function hole(z: ZugangsDaten, heute = new Date()): Promise<AbrufErgebnis> {
  if (!schluesselVorhanden()) {
    return {
      art: "fehler",
      meldung:
        "FINTS_SCHLUESSEL ist nicht gesetzt — die hinterlegte PIN kann " +
        "nicht gelesen werden.",
    };
  }

  const geheim = await one<{ pin_verschluesselt: Buffer | null }>(
    `SELECT pin_verschluesselt FROM fints_zugang WHERE id = $1`,
    [z.id],
  );
  if (!geheim?.pin_verschluesselt) {
    return { art: "fehler", meldung: "Für diesen Zugang ist keine PIN hinterlegt." };
  }

  let pin: string;
  try {
    pin = entschluessele(geheim.pin_verschluesselt);
  } catch (e) {
    // Meist ein gewechselter Schlüssel. Nicht weiterprobieren: Eine
    // Anmeldung mit Datenmüll zählt als Fehlversuch bei der Bank.
    return {
      art: "fehler",
      meldung:
        "Die hinterlegte PIN ist nicht entschlüsselbar " +
        `(${(e as Error).message}). Wurde FINTS_SCHLUESSEL geändert? ` +
        "Die PIN muss dann neu eingegeben werden.",
    };
  }

  const { von, bis, gekuerzt } = zeitraum(z.letzter_abruf, heute);

  try {
    const { FinTSClient, FinTSConfig } = await import("lib-fints");
    const p = produkt();

    const config = z.bank_information
      ? FinTSConfig.fromBankingInformation(
          p.id, p.version,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          z.bank_information as any,
          z.benutzer, pin,
          z.tan_verfahren ?? undefined,
          z.tan_medium ?? undefined,
          z.kunden_id ?? undefined,
        )
      : FinTSConfig.forFirstTimeUse(
          p.id, p.version, z.url, z.bank_id, z.benutzer, pin,
          z.kunden_id ?? undefined,
        );

    const client = new FinTSClient(config);

    // Ohne gespeicherte Bankinformationen muss zuerst synchronisiert
    // werden. Verlangt die Bank dafür eine TAN, bricht es hier ab -- das
    // ist der Einrichtungsfall, nicht der laufende Betrieb.
    if (!z.bank_information) {
      const s = await client.synchronize();
      if (s.requiresTan) {
        return {
          art: "tan_faellig",
          hinweis:
            s.tanChallenge ??
            "Die Bank verlangt für die Erstanmeldung eine TAN.",
          medium: s.tanMediaName ?? null,
        };
      }
      /*
        Die Anmeldung selbst prüfen, und zwar hier.

        lib-fints wirft bei einer abgelehnten Anmeldung keine Ausnahme:
        Sie setzt `success` auf false (Rückmeldecode >= 9000) und legt
        den Klartext der Bank in `bankAnswers`. Ohne diese Abfrage lief
        der Code weiter, fand eine leere Kontenliste und meldete „Die
        Bank liefert kein Konto zu diesem Zugang. Stimmt der
        Anmeldename?" — eine Vermutung, die bei falscher PIN oder
        gesperrtem Zugang in die Irre führt und dazu verleitet, am
        Anmeldenamen zu drehen, während die Bank die Fehlversuche zählt.
        Am 06.11.2026 genau so passiert.

        Jede andere Stelle dieser Datei prüfte `success` bereits; nur
        die Erstanmeldung nicht — also ausgerechnet der Fall, der beim
        Einrichten auftritt.
      */
      if (!s.success) {
        return { art: "fehler", meldung: bankMeldung(s.bankAnswers), vonDerBank: true };
      }
    }

    const konten = client.config.bankingInformation?.upd?.bankAccounts ?? [];
    const konto =
      konten.find(
        (k: { iban?: string }) =>
          z.konto_iban && k.iban && k.iban.replace(/\s/g, "") === z.konto_iban,
      ) ?? konten[0];
    if (!konto) {
      return {
        art: "fehler",
        meldung:
          "Die Bank liefert kein Konto zu diesem Zugang. Stimmt der " +
          "Anmeldename?",
      };
    }

    const antwort = await client.getAccountStatements(konto, von, bis, true);

    if (antwort.requiresTan) {
      return {
        art: "tan_faellig",
        hinweis:
          antwort.tanChallenge ??
          "Die Bank verlangt eine TAN für den Umsatzabruf. Das ist " +
            "normal und passiert etwa alle 90 Tage.",
        medium: antwort.tanMediaName ?? null,
      };
    }
    if (!antwort.success) {
      return {
        art: "fehler",
        meldung:
          antwort.bankAnswers?.map((a) => `${a.code} ${a.text}`).join("; ") ||
          "Die Bank hat den Abruf abgelehnt, ohne einen Grund zu nennen.",
      };
    }

    const umsaetze: FintsUmsatz[] = antwort.statements.flatMap(
      (s) => s.transactions as unknown as FintsUmsatz[],
    );

    return {
      art: "ok",
      buchungen: alsBuchungen(umsaetze),
      von: von.toISOString().slice(0, 10),
      bis: bis.toISOString().slice(0, 10),
      bank_information: antwort.bankingInformationUpdated
        ? client.config.bankingInformation
        : null,
      gekuerzt,
    };
  } catch (e) {
    return { art: "fehler", meldung: (e as Error).message };
  }
}

/** Schreibt das Ergebnis eines Abrufs fort. */
export async function vermerke(
  z: ZugangsDaten,
  kontoId: string,
  e: AbrufErgebnis,
): Promise<{ neu: number; bekannt: number }> {
  if (e.art === "tan_faellig") {
    await query(
      `UPDATE fints_zugang
          SET tan_faellig = true, tan_hinweis = $2, letzter_fehler = NULL
        WHERE id = $1`,
      [z.id, e.hinweis],
    );
    return { neu: 0, bekannt: 0 };
  }
  if (e.art === "fehler") {
    /*
      Bei einem Fehler an den Zugangsdaten wird der Zugang stillgelegt,
      nicht nur vermerkt.

      Vorher blieb `aktiv` stehen und nur `letzter_fehler` wurde
      geschrieben. Bei einer abgelehnten PIN hiess das: Der Lauf
      versucht es abends wieder, am nächsten Morgen noch einmal -- und
      nach drei Versuchen sperrt die Bank den Zugang. Nicht nur für
      diese Software, sondern auch für das Onlinebanking im Browser.

      Ein Netzfehler legt nichts stumm: Der ist beim nächsten Lauf
      vorbei, und ein stillgelegter Zugang, den niemand bemerkt, lässt
      Zahlungen als Rückstand erscheinen. Deshalb die Unterscheidung in
      wegenZugangsdaten().
    */
    /*
      Nur was von der Bank kommt, kann zur Stilllegung führen.

      Die Prüfung allein am Wortlaut war falsch: "Für diesen Zugang ist
      keine PIN hinterlegt" entsteht bei uns, bevor überhaupt jemand die
      Bank anruft, enthält aber das Wort PIN — und legte den Zugang
      still, als hätte die Bank abgelehnt. Beim Einbau am 06.11.2026 in
      der Probe aufgefallen.
    */
    const stillegen = sollStilllegen(e);
    await query(
      `UPDATE fints_zugang
          SET letzter_fehler = $2,
              aktiv = CASE WHEN $3::boolean THEN false ELSE aktiv END
        WHERE id = $1`,
      [z.id, e.meldung.slice(0, 2000), stillegen],
    );
    return { neu: 0, bekannt: 0 };
  }

  let neu = 0;
  let bekannt = 0;
  await tx(async (c) => {
    for (const b of e.buchungen) {
      const r = await c.query(
        `INSERT INTO buchung (konto_id, buchungstag, valuta, betrag, waehrung,
                              absender, verwendungszweck, fingerabdruck)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (konto_id, fingerabdruck) DO NOTHING
         RETURNING id`,
        [kontoId, b.buchungstag, b.valuta, b.betrag, b.waehrung,
         b.absender, b.verwendungszweck, b.fingerabdruck],
      );
      if (r.rowCount && r.rowCount > 0) neu++;
      else bekannt++;
    }
    // Erst jetzt fortschreiben -- und auf `bis`, nicht auf heute.
    await c.query(
      `UPDATE fints_zugang
          SET letzter_abruf = $2, letzter_erfolg = now(),
              letzter_fehler = NULL, tan_faellig = false, tan_hinweis = NULL,
              bank_information = COALESCE($3::jsonb, bank_information)
        WHERE id = $1`,
      [z.id, e.bis, e.bank_information ? JSON.stringify(e.bank_information) : null],
    );
  });
  return { neu, bekannt };
}
