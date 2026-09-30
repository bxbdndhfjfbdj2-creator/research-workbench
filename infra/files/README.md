# Phase 4A file infrastructure

This directory records the pinned, replaceable infrastructure behind the Research Workbench file boundary. PostgreSQL remains the research truth source; none of these services becomes a scientific fact source.

| Component | Pin | License | Untrusted input / network posture | Replacement boundary |
| --- | --- | --- | --- | --- |
| Uppy Core | 5.2.0 | MIT | Browser handles researcher-selected files and sends only to the configured private tus endpoint. | File upload UI |
| @uppy/tus | 5.1.1 | MIT | Resumable chunks go only to private tusd. | File upload UI |
| tusd | 2.9.2 | MIT | Accepts untrusted bytes; hooks call only private Workbench endpoints. | tus protocol |
| @aws-sdk/client-s3 | 3.1141.0 | Apache-2.0 | Workbench services connect only to the configured private S3-compatible endpoint. | ObjectStoragePort |
| SeaweedFS | 4.47 | Apache-2.0 | Private quarantine/ready object storage; no scientific semantics. | ObjectStoragePort |
| ClamAV | 1.5.4 | GPL-2.0 | clamd scans untrusted bytes on a local socket/private network; signature update egress is infrastructure-controlled. | MalwareScannerPort |
| Apache Tika | 4.0.0 | Apache-2.0 | Parses untrusted documents in an isolated resource-bounded service. | MetadataExtractorPort |
| Docling Serve | 1.35.0 | MIT | Parses untrusted rich documents in an isolated service; model artifacts are prefetched for private runtime. | RichDocumentParserPort |
| pdfjs-dist | 6.3.289 | Apache-2.0 | Browser renders authenticated Workbench content; no third-party viewer/CDN. | PdfPreview |

Upstream:
- https://github.com/transloadit/uppy
- https://github.com/tus/tusd
- https://github.com/seaweedfs/seaweedfs
- https://github.com/Cisco-Talos/clamav
- https://tika.apache.org/
- https://github.com/docling-project/docling-serve
- https://github.com/mozilla/pdf.js
- https://github.com/aws/aws-sdk-js-v3

## Dependency execution policy

No new package in `@research-workbench/storage` is allowed to run an install/native build script. The S3 adapter depends only on `@aws-sdk/client-s3@3.1141.0`; AWS SDK types never cross `ObjectStoragePort`. Credentials are supplied by runtime secret references and are never stored in ResearchEvent, Outbox, logs, or browser state.

## Smoke test

`tests/integration/storage-seaweedfs-smoke.test.ts` always verifies that the production S3 adapter can load. A real SeaweedFS round-trip runs only when `SEAWEEDFS_S3_ENDPOINT` is configured; absence is reported by Vitest as an explicit skip rather than a pass.

GROBID, pgvector, Apache Jena/Fuseki, and Oxigraph are not Phase 4A runtime dependencies.


## Install and native-script decisions

- `@uppy/core@5.2.0`, `@uppy/tus@5.1.1`, `@aws-sdk/client-s3@3.1141.0`, and `pdfjs-dist@6.3.289` are consumed as pinned JavaScript dependencies. Phase 4A does not add an allowlisted postinstall/native build step for these packages.
- tusd, SeaweedFS, ClamAV, Apache Tika, and Docling Serve are runtime infrastructure, not npm install scripts. Deployment must use the pins recorded in `infra/files/version.env` (or an image digest that resolves to that approved version).
- Untrusted file bytes cross only the tusd -> quarantine object storage -> isolated scanner/parser path. Workbench application services exchange IDs, hashes, terminal facts, and derived object references rather than embedding document bodies in events.
- ClamAV signature updates are the only expected recurring infrastructure egress in this set and must be controlled by deployment policy. Docling model artifacts should be prefetched; runtime research documents must not be sent to public model or parsing services.
- Object storage, clamd, Tika, and Docling endpoints are private deployment endpoints. tusd hooks target only the private Workbench hook endpoint. PDF.js loads only the authenticated Workbench content route and uses no CDN.

## Adapter smoke matrix

| Adapter | Always-on proof | Real-service proof | Missing prerequisite behavior |
| --- | --- | --- | --- |
| S3 / SeaweedFS | `packages/storage/src/contract.test.ts` plus production adapter load | `SEAWEEDFS_S3_ENDPOINT` enables round-trip/range smoke | explicit Vitest SKIP |
| ClamAV | `packages/file-processing/src/contract.test.ts` fake scanner contract | `CLAMAV_SOCKET_PATH` or `CLAMAV_HOST` + `CLAMAV_PORT` enables clean/EICAR smoke | explicit Vitest SKIP |
| Apache Tika | fake metadata extractor contract | `TIKA_BASE_URL` enables MIME/metadata/text smoke | explicit Vitest SKIP |
| Docling Serve | fake rich-parser contract | `DOCLING_BASE_URL` enables structured-artifact smoke | explicit Vitest SKIP |
| tusd + SeaweedFS browser path | Phase 4A focused Playwright workflow uses pinned tusd 2.9.2 and SeaweedFS 4.47 containers | same focused workflow | required; not converted to SKIP |

A missing real ClamAV/Tika/Docling endpoint is therefore a recorded **SKIP**, never a PASS. The deterministic fake contracts, PostgreSQL integration tests, and Phase 4A browser acceptance remain required CI evidence.

## Replacement boundaries

- `ObjectStoragePort` is the only application-facing object-storage boundary; SeaweedFS, AWS S3, MinIO-compatible or another S3-compatible implementation can replace the adapter without changing research facts.
- `MalwareScannerPort`, `MetadataExtractorPort`, and `RichDocumentParserPort` isolate ClamAV, Tika, and Docling/GROBID-style processors from the domain model.
- tus is a transport protocol boundary. Workbench owns upload intent authorization, hook validation, idempotent inbox/outbox facts, quarantine policy, and final provenance.
- PostgreSQL remains the source of truth for ResearchFile/FileVersion/FileLink/FileProcessingRecord and operational ingest state. Derived parser artifacts and object storage are not scientific truth sources.
