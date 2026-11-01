import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { gesetzterMandant } from "./mandant";

declare global {
  // eslint-disable-next-line no-var
  var __stigPool: Pool | undefined;
}

export const pool =
  global.__stigPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://stig_app:stig@127.0.0.1:5432/stig",
    max: 10,
  });

if (process.env.NODE_ENV !== "production") global.__stigPool = pool;

/**
 * Den Mandanten fuer diese Abfrage bestimmen.
 *
 * Erst der ausdrueckliche Kontext (mitMandant), dann das Sitzungscookie.
 * Das Cookie zu lesen klappt nur waehrend einer Anfrage -- ausserhalb wirft
 * next/headers, und dann bleibt es bei null.
 */
async function mandantBestimmen(): Promise<string | null> {
  const gesetzt = gesetzterMandant();
  if (gesetzt) return gesetzt;
  try {
    const { mandantAusSitzung } = await import("./anmeldung");
    return await mandantAusSitzung();
  } catch {
    return null;
  }
}

/**
 * Setzt app.mandant fuer die Dauer der Transaktion.
 *
 * SET LOCAL und nicht SET: Die Verbindung geht danach zurueck in den Pool
 * und wird vom naechsten Aufruf weiterbenutzt -- womoeglich fuer einen
 * anderen Mandanten. Eine sitzungsweite Einstellung waere genau der Fehler,
 * den die ganze Konstruktion verhindern soll.
 */
async function setzeMandant(c: PoolClient, mandantId: string) {
  await c.query(`SELECT set_config('app.mandant', $1, true)`, [mandantId]);
}

class KeinMandant extends Error {
  constructor() {
    super(
      "Kein Mandant gesetzt. Entweder fehlt die Anmeldung, oder der Aufruf " +
        "gehoert in mitMandant(...). Ohne Mandanten wuerde die Abfrage nichts " +
        "liefern — das soll auffallen statt stillzubleiben.",
    );
    this.name = "KeinMandant";
  }
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const mandant = await mandantBestimmen();
  if (!mandant) throw new KeinMandant();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setzeMandant(client, mandant);
    const res = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return res.rows;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Führt mehrere Statements in einer Transaktion aus. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const mandant = await mandantBestimmen();
  if (!mandant) throw new KeinMandant();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setzeMandant(client, mandant);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Der Mandant der laufenden Abfrage, als Wert zum Mitschreiben in Spalten.
 * Die Policy verlangt mandant_id bei jedem INSERT -- die Datenbank setzt
 * ihn nicht von selbst ein.
 */
export async function mandantWert(): Promise<string> {
  const m = await mandantBestimmen();
  if (!m) throw new KeinMandant();
  return m;
}
