export const metadata = { title: "Sauti Ledger", description: "Swahili voice ledger with PayPal" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sw">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f4ef" }}>
        {children}
      </body>
    </html>
  );
}
