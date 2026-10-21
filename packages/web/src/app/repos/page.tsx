import { prisma } from "@falkon/db";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const repos = await prisma.repo.findMany({ orderBy: { name: "asc" } });
  return (
    <table>
      <thead>
        <tr>
          <th>Repo</th>
          <th>Status</th>
          <th>Default branch</th>
          <th>Last indexed</th>
        </tr>
      </thead>
      <tbody>
        {repos.map((r) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td className={r.status === "FAILED" ? "err" : ""} title={r.error ?? ""}>
              {r.status}
            </td>
            <td>{r.defaultBranch ?? "-"}</td>
            <td className="muted">{r.lastIndexedAt?.toISOString() ?? "-"}</td>
          </tr>
        ))}
        {repos.length === 0 && (
          <tr>
            <td colSpan={4} className="muted">
              No repos yet. Add connections to config.json and start the backend.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
