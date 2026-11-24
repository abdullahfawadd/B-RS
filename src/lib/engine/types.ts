export type Limits = { maxFile: number; maxSource: number; maxArchive: number; maxFiles: number };
export type InputFile = { path: string; data: Buffer };
export type Manifest = { version: 1; files: Array<{ path: string; size: number; sha256: string }> };
export type EngineErrorCode = "invalid" | "limit" | "corrupted" | "decryption";
export type RestoreFailure = { path: string; error: string };
export type RestoreResult = {
  manifest: Manifest;
  files: InputFile[];
  restoreMs: number;
  verificationMs: number;
  bytes: number;
  failures: RestoreFailure[];
};

export class EngineError extends Error {
  constructor(public readonly code: EngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EngineError";
  }
}
