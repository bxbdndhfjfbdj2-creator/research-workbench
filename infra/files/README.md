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
