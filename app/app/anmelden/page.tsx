import { AnmeldeFormular } from "@/components/AnmeldeFormular";

export const metadata = { title: "Anmelden — STIG Verwaltung" };

export default async function Anmelden({
  searchParams,
}: {
  searchParams: Promise<{ weiter?: string }>;
}) {
  const { weiter } = await searchParams;
  return (
    <div style={{ maxWidth: "22rem", margin: "4rem auto 0" }}>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 0.5rem",
        }}
      >
        Anmelden
      </h1>
      <p className="hinweis">
        Hier liegen Mieterdaten. Der Zugang ist auf die Verwaltung beschränkt.
      </p>
      <AnmeldeFormular weiter={weiter ?? "/"} />
    </div>
  );
}
