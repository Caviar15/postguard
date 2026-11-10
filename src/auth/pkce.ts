import { createHash, randomBytes } from "node:crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function randomState(): string {
  return randomBytes(16).toString("base64url");
}
