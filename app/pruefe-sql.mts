/**
 * Jede feste SQL-Abfrage der Anwendung einmal an die Datenbank halten.
 *
 * WOFÜR
 *
 * Die Tests dieses Projekts sind rein: Sie lesen Quelltext und rechnen,
 * aber sie sprechen mit keiner Datenbank. Das ist schnell und
 * verlässlich -- und es hat eine Lücke, die am 06.11.2026 bis in den
 * Betrieb gelaufen ist.
 *
 * Die neue Route /api/belege/pruefung hatte in ihrer Abfrage ein
 * `< -$1`. Ein unary Minus auf einem Parameter, dessen Typ Postgres
 * nicht kennt, ist nicht eindeutig; die Datenbank bricht mit "operator
 * is not unique: - unknown" ab. 1404 Tests waren grün, `tsc` war
 * sauber, das Einspielen war grün -- und die Route antwortete im
 * Betrieb mit 500. Kein Test konnte das sehen, weil keiner die Abfrage
 * ausgeführt hat.
 *
 * Dieses Stück schließt die Lücke an der einzigen Stelle, an der schon
 * eine echte Datenbank steht: im Prüflauf, direkt nach den
 * Migrationen. Es nimmt jede SQL-Abfrage, die als fester Text im
 * Quelltext steht, und legt sie der Datenbank mit PREPARE vor. PREPARE
 * plant die Abfrage und führt sie NICHT aus: Es prüft also jeden
 * Spaltennamen, jeden Typ und jede Parameterverwendung, ohne eine Zeile
 * zu schreiben oder zu lesen.
 *
 * WAS ES NICHT PRÜFT
 *
 * Abfragen, die zur Laufzeit zusammengesetzt werden (`${...}` im Text).
 * Die sind hier nicht erreichbar; sie werden gezählt und genannt, damit
 * sichtbar bleibt, wie viel ungeprüft ist. Und es prüft keine Logik --
 * eine Abfrage, die plant, kann trotzdem das Falsche zählen.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const ANFANG = /^\s*(?:--[^\n]*\n|\s)*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;

function dateien(wurzel: string): string[] {
  const aus: string[] = [];
  const lauf = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === ".next" || n === "tests") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) lauf(p);
      else if (/\.(ts|tsx|mts)$/.test(n) && n !== "pruefe-sql.mts") aus.push(p);
    }
  };
  lauf(wurzel);
  return aus.sort();
}

/** Die Backtick-Texte einer Datei, mit ihrer Zeilennummer. */
function textbausteine(quelle: string): Array<{ zeile: number; text: string }> {
  const aus: Array<{ zeile: number; text: string }> = [];
  let i = 0;
  while (i < quelle.length) {
    const a = quelle.indexOf("`", i);
    if (a < 0) break;
    // Ein Backtick, dem ein Backslash vorausgeht, zaehlt nicht.
    if (a > 0 && quelle[a - 1] === "\\") {
      i = a + 1;
      continue;
    }
    let b = a + 1;
    while (b < quelle.length) {
      if (quelle[b] === "\\") {
        b += 2;
        continue;
      }
      if (quelle[b] === "`") break;
      b += 1;
    }
    if (b >= quelle.length) break;
    aus.push({
      zeile: quelle.slice(0, a).split("\n").length,
      text: quelle.slice(a + 1, b),
    });
    i = b + 1;
  }
  return aus;
}

const client = new Client({
  host: process.env.PGHOST ?? "/tmp",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  database: process.env.PGDATABASE ?? "postgres",
  password: process.env.PGPASSWORD,
});
await client.connect();

let geprueft = 0;
let zusammengesetzt = 0;
const fehler: string[] = [];
const offen: string[] = [];

for (const datei of dateien(".")) {
  const quelle = readFileSync(datei, "utf8");
  for (const b of textbausteine(quelle)) {
    if (!ANFANG.test(b.text)) continue;
    if (b.text.includes("${")) {
      zusammengesetzt += 1;
      offen.push(`${datei}:${b.zeile}`);
      continue;
    }
    geprueft += 1;
    const name = `p_${geprueft}`;
    try {
      await client.query(`PREPARE ${name} AS ${b.text}`);
      await client.query(`DEALLOCATE ${name}`);
    } catch (e) {
      const erste = b.text.trim().split("\n")[0].trim().slice(0, 90);
      fehler.push(
        `${datei}:${b.zeile}\n    ${erste}\n    ${(e as Error).message}`,
      );
    }
  }
}
await client.end();

console.log(`${geprueft} feste SQL-Abfragen an die Datenbank gehalten.`);
if (zusammengesetzt > 0) {
  console.log(
    `${zusammengesetzt} zur Laufzeit zusammengesetzte Abfragen bleiben hier ungeprueft:`,
  );
  for (const o of offen) console.log(`  ${o}`);
}
if (fehler.length > 0) {
  console.log(`\n${fehler.length} Abfrage(n) planen nicht:`);
  for (const f of fehler) console.log(`  ${f}`);
  process.exit(1);
}
console.log("Alle planen.");
