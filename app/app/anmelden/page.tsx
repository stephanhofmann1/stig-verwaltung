import { AnmeldeFormular } from "@/components/AnmeldeFormular";

export const metadata = { title: "Anmelden — STIG Verwaltung" };

export default async function Anmelden({
  searchParams,
}: {
  searchParams: Promise<{ weiter?: string }>;
}) {
  const { weiter } = await searchParams;
  return (
    /* Die Anmeldung wie bei einem Apple-Konto: in der Mitte das Zeichen der
       Anwendung, darunter Titel, ein Satz und die zwei Felder. */
    <div className="anmeldung">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="anmeldung-zeichen"
        src="/apple-touch-icon.png"
        alt=""
        width={64}
        height={64}
      />
      <h1>Anmelden</h1>
      <p className="hinweis">
        Hier liegen Mieterdaten. Der Zugang ist auf die Verwaltung beschränkt.
      </p>
      <AnmeldeFormular weiter={weiter ?? "/cockpit"} />
    </div>
  );
}
