export type LocalFileInput = {
  path: string;
  originalFilename: string;
  byteSize: number;
  sha256: string;
};

export type MalwareScanResult = {
  verdict: "clean" | "malware";
  signatureName: string | null;
  scannerVersion: string;
  signatureDatabaseVersion: string;
};

export interface MalwareScannerPort {
  scan(input: LocalFileInput): Promise<MalwareScanResult>;
}

export type MetadataExtractionResult = {
  mediaTypeDetected: string;
  metadataArtifact: Uint8Array;
  textArtifact: Uint8Array | null;
  processorVersion: string;
};

export interface MetadataExtractorPort {
  extract(input: LocalFileInput): Promise<MetadataExtractionResult>;
}

export type RichDocumentArtifact = {
  kind: "json" | "markdown" | "html";
  bytes: Uint8Array;
};

export type RichDocumentParseResult = {
  supported: boolean;
  artifacts: RichDocumentArtifact[];
  processorVersion: string;
};

export interface RichDocumentParserPort {
  parse(input: LocalFileInput, mediaType: string): Promise<RichDocumentParseResult>;
}
