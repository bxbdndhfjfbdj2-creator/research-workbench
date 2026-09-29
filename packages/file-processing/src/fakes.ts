import type {
  LocalFileInput,
  MalwareScannerPort,
  MalwareScanResult,
  MetadataExtractionResult,
  MetadataExtractorPort,
  RichDocumentArtifact,
  RichDocumentParseResult,
  RichDocumentParserPort,
} from "./types";

type FakeMalwareScannerOptions = {
  verdict?: "clean" | "malware";
  signatureName?: string | null;
  scannerVersion?: string;
  signatureDatabaseVersion?: string;
  errorCode?: string;
};

export class FakeMalwareScanner implements MalwareScannerPort {
  constructor(private readonly options: FakeMalwareScannerOptions = {}) {}

  async scan(_input: LocalFileInput): Promise<MalwareScanResult> {
    if (this.options.errorCode) throw new Error(this.options.errorCode);
    const verdict = this.options.verdict ?? "clean";
    return {
      verdict,
      signatureName:
        verdict === "malware"
          ? this.options.signatureName ?? "Fake-Signature"
          : null,
      scannerVersion: this.options.scannerVersion ?? "fake-scanner",
      signatureDatabaseVersion:
        this.options.signatureDatabaseVersion ?? "fake-signature-db",
    };
  }
}

type FakeMetadataExtractorOptions = {
  mediaTypeDetected?: string;
  metadataText?: string;
  extractedText?: string | null;
  processorVersion?: string;
  errorCode?: string;
};

export class FakeMetadataExtractor implements MetadataExtractorPort {
  constructor(private readonly options: FakeMetadataExtractorOptions = {}) {}

  async extract(_input: LocalFileInput): Promise<MetadataExtractionResult> {
    if (this.options.errorCode) throw new Error(this.options.errorCode);
    const encoder = new TextEncoder();
    return {
      mediaTypeDetected:
        this.options.mediaTypeDetected ?? "application/octet-stream",
      metadataArtifact: encoder.encode(this.options.metadataText ?? "{}"),
      textArtifact:
        this.options.extractedText === null
          ? null
          : encoder.encode(this.options.extractedText ?? ""),
      processorVersion: this.options.processorVersion ?? "fake-metadata",
    };
  }
}

type FakeRichDocumentParserOptions = {
  supported?: boolean;
  artifacts?: Array<{
    kind: RichDocumentArtifact["kind"];
    text: string;
  }>;
  processorVersion?: string;
  errorCode?: string;
};

export class FakeRichDocumentParser implements RichDocumentParserPort {
  constructor(private readonly options: FakeRichDocumentParserOptions = {}) {}

  async parse(
    _input: LocalFileInput,
    _mediaType: string,
  ): Promise<RichDocumentParseResult> {
    if (this.options.errorCode) throw new Error(this.options.errorCode);
    const supported = this.options.supported ?? true;
    const encoder = new TextEncoder();
    return {
      supported,
      artifacts: supported
        ? (this.options.artifacts ?? []).map((artifact) => ({
            kind: artifact.kind,
            bytes: encoder.encode(artifact.text),
          }))
        : [],
      processorVersion:
        this.options.processorVersion ?? "fake-rich-document-parser",
    };
  }
}
