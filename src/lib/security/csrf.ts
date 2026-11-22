import { createHmac, timingSafeEqual } from "node:crypto";

const noncePattern = /^[a-f0-9]{64}$/;

function assertCsrfSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("CSRF_SECRET must contain at least 32 bytes.");
  }
}

function signatureFor(
  subjectId: string | null,
  nonce: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${subjectId ?? "anonymous"}:${nonce}`)
    .digest("base64url");
}

export function createCsrfToken(
  subjectId: string | null,
  nonce: string,
  secret: string,
): string {
  assertCsrfSecret(secret);

  if (!noncePattern.test(nonce)) {
    throw new Error("CSRF nonce must be a 32-byte hexadecimal value.");
  }

  return `${nonce}.${signatureFor(subjectId, nonce, secret)}`;
}

export function verifyCsrfToken({
  token,
  cookieNonce,
  subjectId,
  secret,
}: {
  token: string | null;
  cookieNonce: string | null;
  subjectId: string | null;
  secret: string;
}): boolean {
  if (
    Buffer.byteLength(secret, "utf8") < 32 ||
    !token ||
    !cookieNonce ||
    !noncePattern.test(cookieNonce)
  ) {
    return false;
  }

  const [tokenNonce, suppliedSignature, extra] = token.split(".");
  if (
    extra !== undefined ||
    tokenNonce !== cookieNonce ||
    !suppliedSignature ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)
  ) {
    return false;
  }

  const expected = Buffer.from(
    signatureFor(subjectId, cookieNonce, secret),
    "base64url",
  );
  const supplied = Buffer.from(suppliedSignature, "base64url");

  return (
    supplied.length === expected.length &&
    supplied.toString("base64url") === suppliedSignature &&
    timingSafeEqual(supplied, expected)
  );
}

export function hasValidOrigin(
  origin: string | null,
  expectedOrigin: string,
): boolean {
  if (!origin) {
    return false;
  }

  try {
    const expected = new URL(expectedOrigin);
    const actual = new URL(origin);
    return (
      (expected.protocol === "https:" || expected.protocol === "http:") &&
      expected.origin === expectedOrigin &&
      expected.origin === actual.origin &&
      actual.origin === origin
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }

    throw error;
  }
}
