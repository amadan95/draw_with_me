import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-page">
      <div className="landing-card">
        <p className="landing-kicker">draw with AI</p>
        <h1>Warm paper, pinned comments, and Gemini turns.</h1>
        <p className="landing-copy">
          This rebuild keeps the handmade collaborative aesthetic of the
          reference while running as a standalone Gemini app.
        </p>
        <Link className="landing-link" href="/draw">
          Open the canvas
        </Link>
      </div>
    </main>
  );
}
