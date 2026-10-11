"use client";
import { useState } from "react";
import { GitBranch, Search } from "lucide-react";
import type { Repository } from "@/lib/contracts";
import { Badge } from "@/components/ui/primitives";

export default function RepositoryPicker({
  repositories,
  selected,
  onChange,
}: {
  repositories: Repository[];
  selected: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState(
    repositories[0]?.organization ?? "acme-payments",
  );
  const organizations = [
    ...new Set(repositories.map((repo) => repo.organization)),
  ];
  const visible = repositories.filter(
    (repo) =>
      repo.organization === organization &&
      repo.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedRepos = repositories.filter((repo) => selected[repo.id]);
  const allVisible =
    visible.length > 0 && visible.every((repo) => selected[repo.id]);
  function selectAll() {
    const next = { ...selected };
    visible.forEach((repo) => {
      if (allVisible) delete next[repo.id];
      else next[repo.id] = repo.branch;
    });
    onChange(next);
  }
  return (
    <>
      <div className="toolbar">
        <label className="sr-only" htmlFor="organization">
          Organization
        </label>
        <select
          id="organization"
          data-single={organizations.length === 1}
          className="input organization-select"
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
        >
          {organizations.map((org) => (
            <option key={org}>{org}</option>
          ))}
        </select>
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search repositories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${repositories.length} repositories`}
          />
        </label>
      </div>
      <div className="repository-table">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all visible repositories"
                  checked={allVisible}
                  onChange={selectAll}
                  disabled={!visible.length}
                />
              </th>
              <th>Repository</th>
              <th>Language</th>
              <th>Branch</th>
              <th>Head</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((repo) => (
              <tr
                key={repo.id}
                className={selected[repo.id] ? "selected-row" : ""}
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement).closest(
                      "input,select,label,button",
                    )
                  )
                    return;
                  const next = { ...selected };
                  if (next[repo.id]) delete next[repo.id];
                  else next[repo.id] = repo.branch;
                  onChange(next);
                }}
              >
                <td className="repository-checkbox">
                  <input
                    id={`repository-${repo.id}`}
                    type="checkbox"
                    aria-label={`Select ${repo.name}`}
                    checked={!!selected[repo.id]}
                    onChange={(event) => {
                      const next = { ...selected };
                      if (event.target.checked) next[repo.id] = repo.branch;
                      else delete next[repo.id];
                      onChange(next);
                    }}
                  />
                </td>
                <td className="repository-name">
                  <label htmlFor={`repository-${repo.id}`}>
                    <strong>
                      {repo.name}
                      {!repo.structural && (
                        <Badge tone="amber">Text only</Badge>
                      )}
                    </strong>
                    <small className="desktop-repo-meta">
                      Updated {repo.updated}
                    </small>
                    <small className="mobile-repo-meta">
                      {repo.language} · {repo.revision}
                    </small>
                  </label>
                </td>
                <td className="repository-language">
                  <span
                    className={`language-dot lang-${repo.language.toLowerCase()}`}
                  />
                  {repo.language}
                </td>
                <td className="repository-branch">
                  <label className="branch">
                    <GitBranch size={13} />
                    <select
                      aria-label={`Branch for ${repo.name}`}
                      value={selected[repo.id] ?? repo.branch}
                      disabled={!selected[repo.id]}
                      onChange={(event) =>
                        onChange({ ...selected, [repo.id]: event.target.value })
                      }
                    >
                      {repo.branches.map((branch) => (
                        <option key={branch}>{branch}</option>
                      ))}
                    </select>
                  </label>
                </td>
                <td className="mono repository-revision">{repo.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <div className="repository-empty">
            <Search size={24} />
            <strong>No repositories match “{query}”</strong>
            <p>Try a different name or choose another organization.</p>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setQuery("")}
            >
              Clear search
            </button>
          </div>
        )}
        <div className="tfoot">
          <span>
            Showing {visible.length} of {repositories.length}
          </span>
          <span>
            <strong>{selectedRepos.length} selected</strong> ·{" "}
            {selectedRepos.filter((repo) => repo.structural).length} with
            structural extraction
          </span>
        </div>
      </div>
    </>
  );
}
