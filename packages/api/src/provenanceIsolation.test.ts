// P12 (ADR 0001 section 7) against the Postgres ProvenanceStore: the repository filter is applied in SQL, links into a
// repository outside the caller's set are dropped, a never-imported repository is a coverage gap. The same cases run
// against the in-memory store in packages/shared/src/provenance.test.ts. Skipped unless PROVENANCE_TEST_DATABASE_URL is set.
import { after } from "node:test";
import { CONTRACT_REPOS, provenanceStoreContract } from "../../shared/src/provenance.contract";
import { pgClose, pgSkip, pgTestStore } from "../../backend/src/provenancePg.testing";

after(() => pgClose());
provenanceStoreContract("postgres store", () => pgTestStore(CONTRACT_REPOS), pgSkip);
