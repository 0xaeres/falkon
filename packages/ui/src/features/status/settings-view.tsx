"use client";
import Link from "next/link";
import { useWorkspace } from "@/components/layout/workspace-shell";
export function SettingsView() {
  const { product } = useWorkspace();
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">{product.name}</p>
      <section className="page-section">
        <h2>Product</h2>
        <dl className="review-dl">
          <dt>productId</dt>
          <dd className="mono">{product.id}</dd>
          <dt>Code host</dt>
          <dd>{product.host}</dd>
          <dt>Repositories</dt>
          <dd>{product.repositories.length} connected</dd>
        </dl>
        <Link className="btn" href={`/setup?edit=${product.id}`}>
          Edit repositories
        </Link>
      </section>
    </div>
  );
}
