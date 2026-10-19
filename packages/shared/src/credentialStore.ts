import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

/** The columns of a Credential row that `openCredential` needs. Prisma-free: api and backend pass their own rows. */
export interface SealedCredential {
  id: string;
  host: string;
  keyId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

const decodeKey = (b64: string, what: string) => {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new Error(`${what} must be base64 of exactly 32 bytes.`);
  return key;
};

/**
 * FALKON_SECRET_KEY (base64, 32 bytes), else the file named by FALKON_SECRET_KEY_FILE, else a key generated on first
 * use into ${DATA_DIR||/data}/secrets/master.key (mode 600, directory 700). Written to a temp file and hard-linked into
 * place, so a racing process either creates the key or reads the winner's complete one.
 */
export function masterKey(env: Env = process.env): Buffer {
  if (env.FALKON_SECRET_KEY) return decodeKey(env.FALKON_SECRET_KEY, "FALKON_SECRET_KEY");
  if (env.FALKON_SECRET_KEY_FILE) return decodeKey(fs.readFileSync(env.FALKON_SECRET_KEY_FILE, "utf8"), "FALKON_SECRET_KEY_FILE");
  const dir = path.join(env.DATA_DIR || "/data", "secrets");
  const file = path.join(dir, "master.key");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  } finally {
    fs.unlinkSync(tmp);
  }
  return decodeKey(fs.readFileSync(file, "utf8"), "master.key");
}

const keyIdOf = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);
const aad = (id: string, host: string, keyId: string) => Buffer.from(`${id}|${host}|${keyId}`);

export const newCredentialId = () => randomBytes(16).toString("base64url");

/** Encrypts a token for the row `{id, host}`; the result's fields are the Credential columns. */
export function seal(token: string, { id, host }: { id: string; host: string }, env: Env = process.env) {
  const key = masterKey(env);
  const keyId = keyIdOf(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(id, host, keyId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { keyId, nonce, ciphertext };
}

/** The only function that decrypts. The caller holds the result for one outbound call and does not store it. */
export function openCredential(row: SealedCredential, env: Env = process.env): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(env), row.nonce);
    decipher.setAAD(aad(row.id, row.host, row.keyId));
    const sealed = Buffer.from(row.ciphertext);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Credential cannot be decrypted.");
  }
}
