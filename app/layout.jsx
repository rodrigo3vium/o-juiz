import "./globals.css";

export const metadata = {
  title: "O JUIZ — Tribunal da Razão",
  description:
    "Cola uma discussão. A IA expõe os furos, mede os argumentos e crava o vencedor.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
