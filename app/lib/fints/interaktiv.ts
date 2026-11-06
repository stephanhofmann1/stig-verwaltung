import { query, one } from "../db";
import { randomBytes } from "node:crypto";
import { entschluessele, schluesselVorhanden } from "./geheimnis";
import { alsBuchungen, bankMeldung, zeitraum, type ZugangsDaten,
         type FintsUmsatz } from "./abruf";
import { merke, hole as holeSitzung, vergiss } from "./sitzungen";
import type { RohBuchung } from "../kontoimport";

/**
 * Der Abruf mit einem Menschen davor.
 *
 * Unterschied zum nächtlichen Lauf (holen.ts): Verlangt die Bank eine TAN,
 * bricht dieser Weg nicht ab, sondern hält den Dialog offen und fragt
 * zurück. Das ist der Weg für die Einrichtung und für die TAN, die etwa
 * alle 90 Tage fällig wird.
 *
 * Ohne diesen Weg wäre die Anbindung unbenutzbar: Der erste Abruf eines
 * neuen Zugangs verlangt IMMER eine TAN, und der nächtliche Lauf kann
 * keine eingeben.
 */

export type Schritt =
  | { art: "fertig"; neu: number; bekannt: number; von: string; bis: string;
      gekuerzt: boolean }
  | { art: "tan"; token: string; hinweis: string; medium: string | null }
  | { art: "fehler"; meldung: string;
      /** Die Bank hat geantwortet und abgelehnt -- kein Fehler bei uns. */
      vonDerBank?: boolean };

function produkt(): { id: string; version: string } {
  const id = process.env.FINTS_PRODUKT_ID;
  if (!id) {
    throw new Error(
      "FINTS_PRODUKT_ID fehlt. Seit 01.08.2019 lassen die Banken nur " +
        "registrierte Produkte zu. Registrierung über fints.org.",
    );
  }
  return { id, version: process.env.FINTS_PRODUKT_VERSION ?? "1.0" };
}

async function zugang(id: string): Promise<ZugangsDaten | null> {
  return one<ZugangsDaten>(
    `SELECT id, bezeichnung, bank_id, url, benutzer, kunden_id, konto_iban,
            tan_verfahren, tan_medium, bank_information, letzter_abruf::text
       FROM fints_zugang WHERE id = $1`,
    [id],
  );
}

/** Legt die geholten Buchungen ab und schreibt den Zugang fort. */
async function uebernimm(
  zugangId: string,
  buchungen: RohBuchung[],
  bis: string,
  bankInfo: unknown | null,
): Promise<{ neu: number; bekannt: number }> {
  const { tx } = await import("../db");
  const k = await one<{ konto_id: string }>(
    `SELECT konto_id FROM fints_zugang WHERE id = $1`,
    [zugangId],
  );
  let neu = 0;
  let bekannt = 0;
  await tx(async (c) => {
    for (const b of buchungen) {
      const r = await c.query(
        `INSERT INTO buchung (konto_id, buchungstag, valuta, betrag, waehrung,
                              absender, verwendungszweck, fingerabdruck)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (konto_id, fingerabdruck) DO NOTHING
         RETURNING id`,
        [k!.konto_id, b.buchungstag, b.valuta, b.betrag, b.waehrung,
         b.absender, b.verwendungszweck, b.fingerabdruck],
      );
      if (r.rowCount && r.rowCount > 0) neu++;
      else bekannt++;
    }
    await c.query(
      `UPDATE fints_zugang
          SET letzter_abruf = $2, letzter_erfolg = now(),
              letzter_fehler = NULL, tan_faellig = false, tan_hinweis = NULL,
              bank_information = COALESCE($3::jsonb, bank_information)
        WHERE id = $1`,
      [zugangId, bis, bankInfo ? JSON.stringify(bankInfo) : null],
    );
  });
  return { neu, bekannt };
}

/**
 * Startet einen Abruf. Verlangt die Bank eine TAN, bleibt der Dialog offen.
 */
export async function starteAbruf(
  zugangId: string,
  heute = new Date(),
): Promise<Schritt> {
  if (!schluesselVorhanden()) {
    return {
      art: "fehler",
      meldung:
        "FINTS_SCHLUESSEL ist nicht gesetzt. Ohne ihn kann die hinterlegte " +
        "PIN nicht gelesen werden.",
    };
  }
  const z = await zugang(zugangId);
  if (!z) return { art: "fehler", meldung: "Zugang nicht gefunden." };

  const geheim = await one<{ pin_verschluesselt: Buffer | null }>(
    `SELECT pin_verschluesselt FROM fints_zugang WHERE id = $1`,
    [zugangId],
  );
  if (!geheim?.pin_verschluesselt) {
    return { art: "fehler", meldung: "Für diesen Zugang ist keine PIN hinterlegt." };
  }

  let pin: string;
  try {
    pin = entschluessele(geheim.pin_verschluesselt);
  } catch (e) {
    return {
      art: "fehler",
      meldung:
        `Die hinterlegte PIN ist nicht entschlüsselbar (${(e as Error).message}). ` +
        "Wurde FINTS_SCHLUESSEL geändert? Dann muss die PIN neu eingegeben werden.",
    };
  }

  try {
    const { FinTSClient, FinTSConfig } = await import("lib-fints");
    const p = produkt();
    const config = z.bank_information
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? FinTSConfig.fromBankingInformation(p.id, p.version, z.bank_information as any,
          z.benutzer, pin, z.tan_verfahren ?? undefined,
          z.tan_medium ?? undefined, z.kunden_id ?? undefined)
      : FinTSConfig.forFirstTimeUse(p.id, p.version, z.url, z.bank_id,
          z.benutzer, pin, z.kunden_id ?? undefined);
    const client = new FinTSClient(config);

    if (!z.bank_information) {
      const s = await client.synchronize();
      if (s.requiresTan) {
        const token = randomBytes(16).toString("hex");
        merke(token, {
          client, zugangId, zweck: "synchronisieren",
          hinweis: s.tanChallenge ?? "Die Bank verlangt eine TAN.",
          tanReferenz: s.tanReference ?? "",
        });
        return {
          art: "tan", token,
          hinweis: s.tanChallenge ??
            "Die Bank verlangt für die Erstanmeldung eine TAN.",
          medium: s.tanMediaName ?? null,
        };
      }
      /*
        Wie in holen.ts: lib-fints wirft bei abgelehnter Anmeldung keine
        Ausnahme, sondern setzt success=false. Ohne diese Abfrage lief
        der Code in die Kontenliste und meldete "Stimmt der
        Anmeldename?", obwohl die Bank etwas ganz anderes gesagt hatte.
      */
      if (!s.success) {
        return { art: "fehler", meldung: bankMeldung(s.bankAnswers), vonDerBank: true };
      }
    }

    return weiterMitUmsaetzen(client, z, heute);
  } catch (e) {
    return { art: "fehler", meldung: (e as Error).message };
  }
}

/** Holt die Umsätze; hält bei TAN-Anforderung den Dialog offen. */
async function weiterMitUmsaetzen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  z: ZugangsDaten,
  heute: Date,
): Promise<Schritt> {
  const { von, bis, gekuerzt } = zeitraum(z.letzter_abruf, heute);
  const konten = client.config.bankingInformation?.upd?.bankAccounts ?? [];
  const konto =
    konten.find(
      (k: { iban?: string }) =>
        z.konto_iban && k.iban && k.iban.replace(/\s/g, "") === z.konto_iban,
    ) ?? konten[0];
  if (!konto) {
    /*
      Hier ist die Anmeldung bereits geglückt -- sonst waere weiter oben
      abgebrochen worden. Die Bank kennt also Anmeldename und PIN und
      meldet trotzdem kein Konto in den Userparameterdaten (HIUPD).

      Die alte Meldung riet auf den Anmeldenamen und schickte damit in
      die falsche Richtung: Wer bis hierher kommt, hat ihn richtig.
      Haeufigster Grund bei Geschaeftskonten ist, dass die Konten fuer
      FinTS nicht freigeschaltet sind -- die Anmeldung geht, der
      Kontozugriff nicht.

      Der Zusatz zur IBAN steht da, weil die zweite Moeglichkeit eine
      Einschraenkung bei uns ist: Ist im Zugang eine IBAN hinterlegt,
      die nicht zu den gemeldeten Konten passt, faende die Suche nichts
      -- dann liegt es nicht an der Bank.
    */
    return {
      art: "fehler",
      meldung:
        "Die Anmeldung bei der Bank hat geklappt, aber sie meldet kein " +
        "Konto zu diesem Zugang" +
        (z.konto_iban
          ? ` (gesucht wurde ${z.konto_iban}; die Bank nannte ${konten.length} Konto/Konten).`
          : ".") +
        " Anmeldename und PIN stimmen also. Bei Geschäftskonten ist meist " +
        "der Kontozugriff über FinTS nicht freigeschaltet — das muss die " +
        "Bank für jedes Konto einzeln einrichten.",
    };
  }

  const antwort = await client.getAccountStatements(konto, von, bis, true);
  if (antwort.requiresTan) {
    const token = randomBytes(16).toString("hex");
    merke(token, {
      client, zugangId: z.id, zweck: "umsaetze",
      hinweis: antwort.tanChallenge ?? "Die Bank verlangt eine TAN.",
      tanReferenz: antwort.tanReference ?? "",
    });
    return {
      art: "tan", token,
      hinweis: antwort.tanChallenge ??
        "Die Bank verlangt eine TAN für den Umsatzabruf. Das ist normal und " +
        "passiert etwa alle 90 Tage.",
      medium: antwort.tanMediaName ?? null,
    };
  }
  if (!antwort.success) {
    return {
      art: "fehler",
      meldung:
        antwort.bankAnswers?.map((a: { code: string; text: string }) =>
          `${a.code} ${a.text}`).join("; ") ||
        "Die Bank hat den Abruf abgelehnt, ohne einen Grund zu nennen.",
    };
  }

  const umsaetze: FintsUmsatz[] = antwort.statements.flatMap(
    (s: { transactions: FintsUmsatz[] }) => s.transactions,
  );
  const { neu, bekannt } = await uebernimm(
    z.id, alsBuchungen(umsaetze),
    bis.toISOString().slice(0, 10),
    antwort.bankingInformationUpdated ? client.config.bankingInformation : null,
  );
  return {
    art: "fertig", neu, bekannt,
    von: von.toISOString().slice(0, 10),
    bis: bis.toISOString().slice(0, 10),
    gekuerzt,
  };
}

/**
 * Löst eine TAN ein und führt den Abruf zu Ende.
 *
 * Der Dialog wird in jedem Fall verworfen -- auch bei einer falschen TAN.
 * Ein zweiter Versuch auf demselben Dialog zählt bei der Bank als weiterer
 * Fehlversuch, und drei davon sperren den Zugang.
 */
export async function loeseTanEin(
  token: string,
  tan: string,
  heute = new Date(),
): Promise<Schritt> {
  const offen = holeSitzung(token);
  if (!offen) {
    return {
      art: "fehler",
      meldung:
        "Die TAN-Anfrage ist abgelaufen oder die Anwendung wurde neu " +
        "gestartet. Bitte den Abruf neu starten. Ein nicht abgeschlossener " +
        "Vorgang zählt bei der Bank nicht als Fehlversuch.",
    };
  }
  vergiss(token);

  try {
    const z = await zugang(offen.zugangId);
    if (!z) return { art: "fehler", meldung: "Zugang nicht gefunden." };

    if (offen.zweck === "synchronisieren") {
      const s = await offen.client.synchronizeWithTan(offen.tanReferenz, tan);
      if (!s.success) {
        return {
          art: "fehler",
          meldung:
            s.bankAnswers?.map((a) => `${a.code} ${a.text}`).join("; ") ||
            "Die Bank hat die TAN nicht angenommen.",
        };
      }
      // Bankinformationen sichern, damit der nächste Abruf ohne
      // Synchronisation auskommt.
      await query(
        `UPDATE fints_zugang SET bank_information = $2::jsonb WHERE id = $1`,
        [z.id, JSON.stringify(offen.client.config.bankingInformation)],
      );
      return weiterMitUmsaetzen(offen.client, z, heute);
    }

    const antwort = await offen.client.getAccountStatementsWithTan(
      offen.tanReferenz, tan,
    );
    if (!antwort.success) {
      return {
        art: "fehler",
        meldung:
          antwort.bankAnswers?.map((a) => `${a.code} ${a.text}`).join("; ") ||
          "Die Bank hat die TAN nicht angenommen.",
      };
    }
    const { von, bis, gekuerzt } = zeitraum(z.letzter_abruf, heute);
    const umsaetze = antwort.statements.flatMap(
      (s) => s.transactions as unknown as FintsUmsatz[],
    );
    const { neu, bekannt } = await uebernimm(
      z.id, alsBuchungen(umsaetze), bis.toISOString().slice(0, 10),
      antwort.bankingInformationUpdated
        ? offen.client.config.bankingInformation : null,
    );
    return {
      art: "fertig", neu, bekannt,
      von: von.toISOString().slice(0, 10),
      bis: bis.toISOString().slice(0, 10),
      gekuerzt,
    };
  } catch (e) {
    return { art: "fehler", meldung: (e as Error).message };
  }
}
