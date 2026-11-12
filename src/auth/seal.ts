import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

const TAG_BYTES = 16;

export function seal(payload: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function open<T>(token: string, secret: string): T | null {
  const [ivPart, tagPart, dataPart] = token.split(".");
  if (!ivPart || !tagPart || !dataPart) return null;
  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    // Node accepts truncated GCM tags (down to 4 bytes) unless told otherwise.
    if (iv.length !== 12 || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function chunk(value: string, size = 3000): string[] {
  if (value.length === 0) return [];
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += size) parts.push(value.slice(index, index + size));
  return parts;
}
