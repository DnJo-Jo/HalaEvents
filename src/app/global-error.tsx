"use client";

// Replaces the root layout when it fails, so it cannot rely on globals.css: styles are inline.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#faf8f5",
          color: "#1b1f24",
          padding: "1rem",
        }}
      >
        <title>Something went wrong · HalaEvents</title>
        <main role="alert" style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>HalaEvents hit an error</h1>
          <p style={{ color: "#545d69", lineHeight: 1.5 }}>
            The application failed to load. No action was taken on your behalf.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.625rem",
              border: 0,
              background: "#0f5c5a",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
