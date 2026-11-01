// Erzeugt einen Passwort-Hash fuer die Umgebungsvariable BENUTZER.
//
//   node hilfsmittel/passwort.mjs stephan
//       fragt das Passwort ab und zeigt die fertige Zeile fuer die .env
//
//   node hilfsmittel/passwort.mjs stephan --stdin
//       liest das Passwort von der Standardeingabe und gibt NUR
//       "name:scrypt$salz$hash" aus. Dafuer gedacht, dass einrichten.sh
//       das Ergebnis direkt in die .env uebernimmt.
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const name = (process.argv[2] ?? "").trim().toLowerCase();
const vonStdin = process.argv.includes("--stdin");

if (!name) {
  console.error("Aufruf: node hilfsmittel/passwort.mjs <benutzername> [--stdin]");
  process.exit(1);
}

const MINDESTLAENGE = vonStdin ? 10 : 12;

function eintrag(pw) {
  if (pw.length < MINDESTLAENGE) {
    console.error(`\nZu kurz. Mindestens ${MINDESTLAENGE} Zeichen.`);
    process.exit(1);
  }
  const salz = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salz, 64).toString("hex");
  return `${name}:scrypt$${salz}$${hash}`;
}

if (vonStdin) {
  let roh = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (roh += d));
  process.stdin.on("end", () => {
    // Abschliessenden Zeilenumbruch entfernen, falls die Eingabe aus
    // einer Pipe mit echo kam.
    process.stdout.write(eintrag(roh.replace(/\r?\n$/, "")));
  });
} else {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.question(`Passwort fuer "${name}": `, (pw) => {
    rl.close();
    console.log(
      `\nIn die .env eintragen (mehrere Benutzer mit Komma trennen):\n`,
    );
    console.log(`BENUTZER=${eintrag(pw)}\n`);
  });
}
