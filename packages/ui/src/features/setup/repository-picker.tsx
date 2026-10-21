"use client";
import { useState } from "react";
import { Check, ChevronDown, GitBranch, Search } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { Repository } from "@sbc/contracts";
import { Select } from "@/components/ui/select";
import { relativeTime } from "@/lib/format";

export const countLine = (
  repositories: Repository[],
  privateShown: number | null,
) =>
  `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} visible to this token${privateShown === null ? "" : ` · ${privateShown} private`}`;
export const privateOnly = (repositories: Repository[], only: boolean) =>
  only ? repositories.filter((repo) => repo.private) : repositories;

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
  const [only, setOnly] = useState(false);
  const [menuSide, setMenuSide] = useState<"right" | "bottom">("right");
  const [organization, setOrganization] = useState(
    repositories[0]?.organization ?? "acme-payments",
  );
  const organizations = [
    ...new Set(repositories.map((repo) => repo.organization)),
  ];
  const visible = privateOnly(repositories, only).filter(
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
      <div className="repo-count">
        <span>{countLine(repositories, only ? visible.length : null)}</span>
        <label>
          <input
            type="checkbox"
            aria-label="Private only"
            checked={only}
            onChange={(event) => setOnly(event.target.checked)}
          />
          Private only
        </label>
      </div>
      <div className="toolbar">
        <label className="sr-only" htmlFor="organization">
          Organization
        </label>
        <Select
          id="organization"
          label="Organization"
          className="organization-select"
          value={organization}
          onValueChange={setOrganization}
          options={organizations.map((org) => ({ value: org, label: org }))}
        />
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
                    <strong>{repo.name}</strong>
                    {repo.private !== undefined && (
                      <span className="badge">
                        {repo.private ? "Private" : "Public"}
                      </span>
                    )}
                    <small className="desktop-repo-meta">
                      Updated {relativeTime(repo.updated)}
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
                  <Dropdown.Root
                    onOpenChange={(open) => {
                      if (open)
                        setMenuSide(
                          window.matchMedia("(max-width: 767px)").matches
                            ? "bottom"
                            : "right",
                        );
                    }}
                  >
                    <Dropdown.Trigger
                      className="branch"
                      aria-label={`Branch for ${repo.name}`}
                      disabled={!selected[repo.id]}
                    >
                      <GitBranch size={13} aria-hidden="true" />
                      <span className="branch-name">
                        {selected[repo.id] ?? repo.branch}
                      </span>
                      <ChevronDown size={14} aria-hidden="true" />
                    </Dropdown.Trigger>
                    <Dropdown.Portal>
                      <Dropdown.Content
                        className="product-menu branch-menu"
                        onClick={(event) => event.stopPropagation()}
                        side={menuSide}
                        align="start"
                        sideOffset={8}
                        collisionPadding={12}
                        aria-label={`Branches for ${repo.name}`}
                      >
                        <Dropdown.RadioGroup
                          value={selected[repo.id] ?? repo.branch}
                          onValueChange={(branch) =>
                            onChange({ ...selected, [repo.id]: branch })
                          }
                        >
                          {repo.branches.map((branch) => (
                            <Dropdown.RadioItem
                              className="product-item branch-option"
                              key={branch}
                              value={branch}
                            >
                              <span className="branch-name">{branch}</span>
                              <Dropdown.ItemIndicator>
                                <Check size={14} aria-hidden="true" />
                              </Dropdown.ItemIndicator>
                            </Dropdown.RadioItem>
                          ))}
                        </Dropdown.RadioGroup>
                      </Dropdown.Content>
                    </Dropdown.Portal>
                  </Dropdown.Root>
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
            <strong>{selectedRepos.length} selected</strong>
          </span>
        </div>
      </div>
    </>
  );
}
