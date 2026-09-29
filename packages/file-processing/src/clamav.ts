import { createReadStream } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { once } from "node:events";
import type {
  LocalFileInput,
  MalwareScannerPort,
  MalwareScanResult,
} from "./types";

export type ClamAvEndpoint =
  | { socketPath: string }
  | { host: string; port: number };

export type ClamAvScannerOptions = {
  endpoint: ClamAvEndpoint;
  timeoutMs: number;
};

export function encodeClamdChunk(bytes: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + bytes.byteLength);
  new DataView(framed.buffer).setUint32(0, bytes.byteLength, false);
  framed.set(bytes, 4);
  return framed;
}

export function parseClamdScanReply(
  reply: string,
): Pick<MalwareScanResult, "verdict" | "signatureName"> {
  const normalized = reply.replace(/\0+$/g, "").trim();
  if (/:\s*OK$/i.test(normalized)) {
    return { verdict: "clean", signatureName: null };
  }
  const found = normalized.match(/:\s*(.+?)\s+FOUND$/i);
  if (found?.[1]) {
    return { verdict: "malware", signatureName: found[1] };
  }
  throw new Error("CLAMAV_SCAN_ERROR");
}

export function parseClamdVersionReply(reply: string): {
  scannerVersion: string;
  signatureDatabaseVersion: string;
} {
  const normalized = reply.replace(/\0+$/g, "").trim();
  const match = normalized.match(/^ClamAV\s+([^/]+)\/([^/]+)/);
  if (!match?.[1] || !match[2]) throw new Error("CLAMAV_VERSION_ERROR");
  return {
    scannerVersion: match[1],
    signatureDatabaseVersion: match[2],
  };
}

function openSocket(endpoint: ClamAvEndpoint, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket =
      "socketPath" in endpoint
        ? createConnection(endpoint.socketPath)
        : createConnection({ host: endpoint.host, port: endpoint.port });

    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error("CLAMAV_TIMEOUT")));
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.off("error", fail);
      socket.on("error", () => {});
      resolve(socket);
    });
  });
}

async function readReply(socket: Socket): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    const finish = () => {
      cleanup();
      socket.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      if (chunk.includes(0)) finish();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      if (chunks.length > 0) {
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      } else {
        cleanup();
        reject(new Error("CLAMAV_CONNECTION_CLOSED"));
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function writeFrame(socket: Socket, bytes: Uint8Array): Promise<void> {
  if (socket.write(bytes)) return;
  await once(socket, "drain");
}

export class ClamAvScannerAdapter implements MalwareScannerPort {
  constructor(private readonly options: ClamAvScannerOptions) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("ClamAV timeout must be a positive integer");
    }
  }

  private async version(): Promise<{
    scannerVersion: string;
    signatureDatabaseVersion: string;
  }> {
    const socket = await openSocket(this.options.endpoint, this.options.timeoutMs);
    socket.write(Buffer.from("zVERSION\0", "utf8"));
    return parseClamdVersionReply(await readReply(socket));
  }

  private async scanStream(path: string): Promise<
    Pick<MalwareScanResult, "verdict" | "signatureName">
  > {
    const socket = await openSocket(this.options.endpoint, this.options.timeoutMs);
    socket.write(Buffer.from("zINSTREAM\0", "utf8"));
    try {
      for await (const chunk of createReadStream(path)) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        await writeFrame(socket, encodeClamdChunk(bytes));
      }
      await writeFrame(socket, encodeClamdChunk(new Uint8Array()));
      return parseClamdScanReply(await readReply(socket));
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  async scan(input: LocalFileInput): Promise<MalwareScanResult> {
    const version = await this.version();
    const verdict = await this.scanStream(input.path);
    return { ...verdict, ...version };
  }
}
