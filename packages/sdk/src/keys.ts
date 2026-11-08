import { P256Keypair } from '@atproto/crypto';
import { fromString, toString } from 'uint8arrays';

export interface GeneratedSigningKeys {
  /** Base64url-encoded raw P-256 private key bytes (store in OPENGAMING_PRIVATE_KEY env var). */
  privateKeyBase64url: string;
  /** Public `did:key:z...` string to register under `#attestations` in the game's DID document. */
  publicDidKey: string;
  /** Live P256Keypair instance ready for signing. */
  keypair: P256Keypair;
}

/**
 * Generate a fresh P-256 ECDSA signing keypair for Open Gaming inline attestations.
 */
export async function generateSigningKeys(): Promise<GeneratedSigningKeys> {
  const keypair = await P256Keypair.create({ exportable: true });
  const exportedBytes = await keypair.export();
  return {
    privateKeyBase64url: toString(exportedBytes, 'base64url'),
    publicDidKey: keypair.did(),
    keypair,
  };
}

/**
 * Restore an exportable/non-exportable P-256 signing keypair from its base64url private key string.
 */
export async function loadSigningKey(privateKeyBase64url: string): Promise<P256Keypair> {
  const trimmed = privateKeyBase64url.trim();
  if (!trimmed) {
    throw new Error('Private key string cannot be empty.');
  }
  const bytes = fromString(trimmed, 'base64url');
  return P256Keypair.import(bytes, { exportable: false });
}
