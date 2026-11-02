/**
 * Übernimmt die Altdaten aus altdaten.json in die Plattform.
 *
 *   DATABASE_URL=... MANDANT=<uuid> npx tsx import/importieren.mts [--echt]
 *
 * Ohne --echt wird nur geprüft und berichtet, nichts geschrieben (Probelauf).
 *
 * Die eigentliche Arbeit steht in app/lib/altdaten.ts, damit sie auch über
 * die Oberfläche aufrufbar ist (/api/altdaten/import). Diese Datei ist nur
 * noch der Weg von der Kommandozeile hinein.
 */
import { readFileSync } from "node:fs";
import { mitMandant } from "../app/lib/mandant.ts";
import { importiere } from "../app/lib/altdaten.ts";

const daten = JSON.parse(
  readFileSync(new URL("./altdaten.json", import.meta.url), "utf8"),
);
const echt = process.argv.includes("--echt");

const bericht = await mitMandant(process.env.MANDANT!, () =>
  importiere(daten, echt),
);
for (const z of bericht) console.log(z);
process.exit(0);
