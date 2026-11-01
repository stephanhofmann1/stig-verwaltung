import { MieterAnmeldung } from "@/components/MieterAnmeldung";

export const metadata = { title: "Mieterbereich — Anmelden" };

export default async function MieterAnmelden({
  searchParams,
}: {
  searchParams: Promise<{ abgelaufen?: string }>;
}) {
  const { abgelaufen } = await searchParams;
  return (
    <div style={{ maxWidth: "24rem", margin: "4rem auto 0" }}>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 0.5rem",
        }}
      >
        Mieterbereich
      </h1>
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
