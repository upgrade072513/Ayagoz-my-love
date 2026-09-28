import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const CONTRACT_FILE_ENCRYPTION_VERSION = 1;

function getEncryptionKey() {
  const rawKey =
    process.env.FILE_ENCRYPTION_KEY ??
    process.env.CONTRACT_FILE_ENCRYPTION_KEY ??
    "";
  if (!rawKey) throw new Error("Server encryption key is not configured");
  return createHash("sha256").update(rawKey, "utf8").digest();
}

export type EncryptedFile = {
  version: number;
  data: Buffer;
  iv: string;
  authTag: string;
};

export function encryptContractFile(data: Buffer): EncryptedFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return {
    version: CONTRACT_FILE_ENCRYPTION_VERSION,
    data: encrypted,
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptContractFile(
  data: Buffer,
  metadata: { version: number; iv: string; authTag: string }
): Buffer {
  if (metadata.version !== CONTRACT_FILE_ENCRYPTION_VERSION)
    throw new Error("Unsupported contract file encryption version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(metadata.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(metadata.authTag, "hex"));
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
