# Phase 4A Files & Provenance Verification

- Date: 2026-09-30
- Branch: `phase/04-research-operations`
- Phase 4A implementation baseline: `03697b66bb445bbac59a8e3e144319490e975b2d`
- Fresh verified implementation head: `2a17bdea81b0fee4d6177aeb2af5a9a959640d6f`
- Phase 3 base: `1a95b548f4a87eaf908df9ce46db1dd7de02e8d3`
- Verification workflow run: GitHub Actions CI `36693927148`
- Execution mode: Native / `superpowers:executing-plans` because the current harness exposes no subagent-dispatch tool.

## Verification verdict for the implementation tree

The implementation tree at `2a17bdea81b0fee4d6177aeb2af5a9a959640d6f` passed the repository's fresh full CI pipeline. This record is committed after that evidence. The record commit itself must also receive an exact-head successful GitHub Actions run before Phase 4A is declared verified and before its Draft PR is prepared.

## Fresh full CI evidence

The CI workflow executed the repository equivalents of the approved final gate:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm acceptance
```

This environment did not provide a local checkout capable of running the repository, so final execution evidence is the exact-head GitHub Actions run rather than a local shell run.

Observed results on run `36693927148`:

- dependency install: PASS
- `pnpm test`: PASS
  - 44 test files passed
  - 3 test files skipped
  - 162 tests passed
  - 6 tests skipped
- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm build`: PASS
- Playwright browser installation: PASS
- `pnpm acceptance`: PASS
  - 20 browser tests passed
  - 0 browser tests failed
  - duration reported by Playwright: approximately 3.7 minutes

The full acceptance command covered Phase 1, research network, scientific-decision locking, Phase 3 Agent runtime, and Phase 4A Files & Provenance.

## Phase 4A browser evidence

`tests/acceptance/files-provenance.spec.ts` contains 9 passing scenarios:

1. create a logical ResearchFile, upload v1 through real tusd, and show immutable provenance;
2. recover one tus upload after a chunk connection reset without creating a second upload/version;
3. quarantine malware without exposing a formal downloadable FileVersion;
4. upload v2 while preserving immutable and downloadable v1 history;
5. link the current FileVersion to research provenance subjects;
6. register restricted external data without tus bytes and redact locator metadata for an ordinary collaborator;
7. render the first PDF page from the authenticated Workbench content route through PDF.js;
8. preserve a clean, downloadable file when the rich parser fails and Tika fallback remains available;
9. preserve structured parser-failure provenance without leaking the parser's internal error details.

The focused `Phase 4A File Acceptance` workflow was used during TDD/debugging for fast browser feedback. Final completion evidence is the full CI acceptance run above.

## Adapter and external-service verification matrix

| Boundary | Deterministic/always-on evidence | Real-service evidence in this CI environment | Result |
| --- | --- | --- | --- |
| ObjectStoragePort | fake contract tests + production S3 adapter load | standalone `SEAWEEDFS_S3_ENDPOINT` smoke was not configured; Phase 4A browser acceptance starts pinned SeaweedFS 4.47 and exercises real S3-compatible storage with tusd | PASS for contracts and real browser path; standalone smoke SKIP |
| tus/tusd | hook contract/integration tests | pinned tusd 2.9.2 + SeaweedFS 4.47 in Playwright acceptance | PASS |
| ClamAV | fake scanner contract and processing integration tests | no `CLAMAV_SOCKET_PATH` or `CLAMAV_HOST/PORT` endpoint configured | real smoke SKIP |
| Apache Tika | fake metadata extractor contract and fallback integration tests | no `TIKA_BASE_URL` configured | real smoke SKIP |
| Docling Serve | fake rich-parser contract and parser-failure integration/browser tests | no `DOCLING_BASE_URL` configured | real smoke SKIP |
| PDF.js | build plus authenticated-content browser scenario | browser-side renderer uses bundled `pdfjs-dist`, no CDN | PASS |

The skipped real-service smokes remain explicit SKIPs and are not counted as PASS.

Two additional existing Phase 3 harness tests were also skipped because real Agent/provider execution remains intentionally unavailable; that pre-existing product-owner decision is unchanged and was not converted into a PASS.

## Pinned open-source dependencies

| Component | Pin | License |
| --- | --- | --- |
| Uppy Core | 5.2.0 | MIT |
| `@uppy/tus` | 5.1.1 | MIT |
| tusd | 2.9.2 | MIT |
| `@aws-sdk/client-s3` | 3.1141.0 | Apache-2.0 |
| SeaweedFS | 4.47 | Apache-2.0 |
| ClamAV | 1.5.4 | GPL-2.0 |
| Apache Tika | 4.0.0 | Apache-2.0 |
| Docling Serve | 1.35.0 | MIT |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 |

Install-script, runtime egress, network-isolation, replacement-port, and smoke-test policies are recorded in `infra/files/README.md`.

## Data model and invariant verification

The implementation establishes the approved Phase 4A facts and operational records:

- `ResearchFile` as logical identity;
- immutable `FileVersion`;
- content-addressed `FileBlob`;
- immutable `ExternalDataReference`;
- append-only `FileLink` plus immutable retirement facts;
- immutable `FileProcessingRecord`;
- mutable operational `FileUploadIntent` and `FileIngestProcessorAttempt`;
- bounded PostgreSQL FTS projection.

Verified invariants include:

- FileVersion UPDATE/DELETE rejected at the database layer;
- ExternalDataReference, FileLink, FileLinkRetirement, and FileProcessingRecord mutation rejected at the database layer;
- `(research_file_id, version_number)` unique;
- FileVersion is backed by exactly one blob or external reference;
- uploaded FileVersion requires a clean terminal scan fact;
- external-reference versions use `not_applicable` scan/parse status;
- `currentVersionId` must point to the same ResearchFile;
- successful processor facts require output references;
- concurrent new-version finalization allocates monotonic versions and preserves one current pointer;
- duplicate tus completion is idempotent through IntegrationInbox/Outbox;
- original filename never becomes the storage key;
- malware bytes remain quarantined/audited and do not become a formal FileVersion;
- rich-parser failure can become `ready_with_parse_error` while the clean original remains downloadable;
- clean physical blob deduplication does not collapse distinct FileVersion provenance.

## Security and governance review

Because this harness has no independent subagent/reviewer dispatch capability, the approved fallback execution used a manual coordinator invariant review. This is **not** represented as an independent reviewer pass. The limitation remains recorded here.

The manual review covered:

- FileVersion immutability and version concurrency;
- quarantine versus ready boundaries;
- forged tus callback/storage locators;
- inbox/outbox callback idempotency;
- restricted-data locator redaction;
- secret/presigned-query leakage;
- Observation / Claim / Decision separation;
- adapter isolation and replacement boundaries;
- old-version and failure-history preservation;
- permission separation between formal project `write` and file-specific `file_write`.

Two concrete security findings were discovered and fixed through RED -> GREEN tests:

### 1. Credential-shaped ResearchEvent / Outbox keys

A RED regression proved the generic secret guard did not reject common storage credential keys such as `accessKeyId` and `secretAccessKey`.

- RED: `601fefe251b5d3144e88f8fa920dc1e2a611ac20`
- GREEN: `2ebe66a6ed30f690a1e9f75e51029f2d00d86c99`

The generic payload guard now also rejects normalized AWS access/secret/session/security token fields. The cross-flow regression additionally verifies that upload bearer tokens, raw document text, raw Tika/Docling payload markers, ClamAV internal signature detail, restricted locators, and parser internal error text do not appear in governed event/outbox/inbox/processing facts or metrics. File processing does not create ScientificDecision or ResearchResult rows.

### 2. Presigned external-data locators

Manual review found that exact query-key matching did not reject vendor-prefixed presigned URL keys such as `X-Amz-Credential`, `X-Amz-Signature`, or `X-Amz-Security-Token`.

- RED: `0d6ec534103eac5849c9f6b2c163b0a69452aa90`
- GREEN: `2a17bdea81b0fee4d6177aeb2af5a9a959640d6f`

External locator validation now rejects normalized query keys that equal or end with credential/secret/token/signature classes, preserving the invariant that ExternalDataReference stores controlled locators but not embedded credentials.

No other high-severity invariant issue was found in the manual review.

One reviewed item that was **not** a defect: application content descriptors use the logical storage namespace `ready`; the Web `ReadyFileStorage` adapter maps that namespace to the configured `FILE_READY_BUCKET`, so the deployment bucket is not hard-coded into the domain/application layer.

## Source-of-truth and scientific-governance checks

- PostgreSQL Workbench facts remain the research/governance source of truth.
- Object storage, tusd, scanner, and parsers are replaceable infrastructure and are not scientific truth sources.
- File parser output remains source/observation material; processing does not automatically create a formal Claim, ResearchResult, or ScientificDecision.
- Restricted raw social-science data can be registered as ExternalDataReference without copying raw bytes into normal Workbench storage.
- Search projection stores bounded extracted text and safe MIME metadata; it does not index restricted locator metadata or raw parser JSON.
- No Phase 4B unified review or Phase 4C progress-cockpit product implementation was pulled into this phase.

## Scope / commit range

The verified implementation spans:

```
03697b66bb445bbac59a8e3e144319490e975b2d
..
2a17bdea81b0fee4d6177aeb2af5a9a959640d6f
```

GitHub compare reports 100 commits and 83 changed files in that range. Changes are confined to the Phase 4A plan, domain/database/application/storage/file-processing/worker/Web surfaces, tests/acceptance infrastructure, file dependency governance, and the generic secret-safety guard needed by the new file event payloads.

## Known limitations / explicit non-PASS items

- Real DeepSeek/Codex/Claude or other Agent Provider/API smoke remains out of scope and skipped by product-owner decision. AI-native architecture remains unchanged.
- Standalone real ClamAV, Tika, and Docling endpoint smokes are skipped when those private services are not configured.
- The standalone SeaweedFS integration smoke is skipped without `SEAWEEDFS_S3_ENDPOINT`, while the real tusd + SeaweedFS path is exercised and passed in browser acceptance.
- No independent subagent code reviewer was available in this harness; manual invariant review was used and the limitation is explicit.
- Phase 4B and Phase 4C remain future gated work.

## Final GitHub gate

At the time this record was authored, no Phase 4A pull request existed from `phase/04-research-operations` to `phase/03-agent-runtime`.

After this record is committed:

1. read the new branch head from GitHub;
2. require a successful CI run for that exact record-commit head;
3. create a **Draft** pull request from `phase/04-research-operations` to `phase/03-agent-runtime` if one still does not exist;
4. include verified invariants, CI evidence, explicit smoke SKIPs, and review limitations in the PR description;
5. do not enable auto-merge and do not merge the Draft PR.
