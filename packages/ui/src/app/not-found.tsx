import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="document-page">
      <h1>Page not found</h1>
      <p>This page does not exist in Falkon.</p>
      <Link className="btn pri" href="/">
        Open status
      </Link>
    </main>
  );
}
