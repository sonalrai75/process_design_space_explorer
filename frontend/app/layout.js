export const metadata = {
  title: "Process Design Space Explorer",
  description: "Process mining, simulation, and evolving-SVD design optimization"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          fontFamily: "Arial, sans-serif",
          background: "#f6f7f9",
          color: "#111827"
        }}
      >
        {children}
      </body>
    </html>
  );
}