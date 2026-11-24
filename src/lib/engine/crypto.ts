import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { EngineError } from "./types";

const magic = Buffer.from("BRS-GCM\x01", "ascii");
const nonceSize = 12;
const tagSize = 16;
export const encryptionOverhead = magic.length + nonceSize + tagSize;

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function encryptArchive(zip: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new EngineError("invalid", "The backup encryption key must contain exactly 32 bytes.");
  }
  const nonce = randomBytes(nonceSize);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: tagSize });
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(zip), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptArchive(artifact: Buffer, key?: Buffer): Buffer {
  if (!artifact.subarray(0, magic.length).equals(magic)) {
    if (key) throw new EngineError("decryption", "The archive lacks the expected encryption envelope.");
    return artifact;
  }
  if (!key || key.length !== 32 || artifact.length <= encryptionOverhead) {
    throw new EngineError("decryption", "The encryption envelope or configured key is unavailable.");
  }
  const tagOffset = magic.length + nonceSize;
  const nonce = artifact.subarray(magic.length, tagOffset);
  const tag = artifact.subarray(tagOffset, encryptionOverhead);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: tagSize });
    decipher.setAAD(magic);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(artifact.subarray(encryptionOverhead)), decipher.final()]);
  } catch (cause) {
    throw new EngineError("decryption", "The encrypted archive failed authentication.", { cause });
  }
}
