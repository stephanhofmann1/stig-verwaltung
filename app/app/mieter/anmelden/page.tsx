import { MieterAnmeldung } from "@/components/MieterAnmeldung";

export const metadata = { title: "Mieterbereich — Anmelden" };

export default async function MieterAnmelden({
  searchParams,
}: {
  searchParams: Promise<{ abgelaufen?: string }>;
}) {
  const { abgelaufen } = await searchParams;
  return (
    // Schmale Spalte innerhalb des Rahmens. Dafuer fehlt im Stylesheet eine
    // Klasse (etwa .schmal); bis es sie gibt, bleibt die Breite als einziger
    // Inline-Stil dieser Seite stehen. Die Typografie der Ueberschrift kommt
    // aus globals.css -- h1 ist dort bereits gesetzt.
    <div style={{ maxWidth: "24rem", margin: "4rem auto 0" }}>
      <h1>Mieterbereich</h1>
      {abgelaufen ? (
        <p className="hinweis">
          Der Link war abgelaufen oder schon benutzt. Fordern Sie einfach einen
          neuen an.
        </p>
      ) : (
        <p className="hinweis">
          Kein Passwort nötig. Sie bekommen einen Link an die Adresse, die in
          Ihrem Mietvertrag steht.
        </p>
      )}
      <MieterAnmeldung />
    </div>
  );
}
