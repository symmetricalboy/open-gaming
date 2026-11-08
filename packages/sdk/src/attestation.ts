import { encode as dagCborEncode, code as DAG_CBOR_CODEC } from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { verifySignature, type Keypair } from '@atproto/crypto';
import { DidResolver } from '@atproto/identity';
import { fromString, toString } from 'uint8arrays';
import { ATTESTATION_KEY_FRAGMENT, NSIDS } from './constants.js';
import { isRecordRevoked } from './revocation.js';
import type {
  AchievementProgressRecord,
  AchievementUnlockRecord,
  InlineSignature,
  LeaderboardScoreRecord,
  RevocationRecord,
  RevocationWithOrigin,
  VerificationResult,
} from './types.js';

export interface SignatureMetadataInput {
  $type: string;
  key: string;
  issuer?: string;
  issuedAt?: string;
  [extra: string]: unknown;
}

function assertNoUndefined(value: unknown, path = 'record'): void {
  if (value === undefined) {
    throw new Error(`Cannot DAG-CBOR encode: "${path}" is undefined.`);
  }
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertNoUndefined(item, `${path}[${idx}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(v, `${path}.${k}`);
  }
}

/**
 * Normalize CBOR-unsafe or optional undefined fields cleanly before encoding.
 */
function stripUndefinedShallow<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Compute the deterministic repository-bound CIDv1 (`bafy...`) for an Open Gaming record,
 * following the `badge.blue` CID-First Attestation Specification:
 * 1. Strip `signatures` from the record.
 * 2. Strip `cid` and `signature` from the signature metadata, and inject `repository: playerDid`.
 * 3. Insert prepared metadata as `$sig` on the record, encode to DAG-CBOR, and SHA-256 -> CIDv1.
 */
export async function computeAttestationCid({
  record,
  metadata,
  repositoryDid,
}: {
  record: Record<string, unknown>;
  metadata: SignatureMetadataInput;
  repositoryDid: string;
}): Promise<CID> {
  if (!repositoryDid.startsWith('did:')) {
    throw new Error(`Invalid repositoryDid: expected DID starting with "did:", got "${repositoryDid}".`);
  }

  const { signatures: _sigs, ...recordWithoutSigs } = record;
  const { signature: _sig, cid: _cid, ...metadataClean } = metadata;

  const sigPayload = stripUndefinedShallow({
    ...metadataClean,
    repository: repositoryDid,
  });

  const attestationPayload = stripUndefinedShallow({
    ...recordWithoutSigs,
    $sig: sigPayload,
  });

  assertNoUndefined(attestationPayload);

  const cborBytes = dagCborEncode(attestationPayload);
  const digest = await sha256.digest(cborBytes);
  return CID.createV1(DAG_CBOR_CODEC, digest);
}

/**
 * Sign any Open Gaming record (unlock, progress, or score) using Mode A inline attestation.
 * Returns the `InlineSignature` object and computed `attestationCid` string.
 */
export async function createInlineSignature({
  record,
  issuerDid,
  playerDid,
  signingKey,
  issuedAt = new Date().toISOString(),
  keyId,
}: {
  record: Record<string, unknown>;
  issuerDid: string;
  playerDid: string;
  signingKey: Keypair;
  issuedAt?: string;
  keyId?: string;
}): Promise<{ signature: InlineSignature; attestationCid: string }> {
  if (!issuerDid.startsWith('did:')) {
    throw new Error(`Invalid issuerDid: expected DID, got "${issuerDid}".`);
  }
  const resolvedKeyId = keyId ?? `${issuerDid}${ATTESTATION_KEY_FRAGMENT}`;
  const metadata: SignatureMetadataInput = stripUndefinedShallow({
    $type: `${NSIDS.Defs}#inlineSignature`,
    key: resolvedKeyId,
    issuer: issuerDid,
    issuedAt,
  }) as SignatureMetadataInput;

  const cid = await computeAttestationCid({
    record,
    metadata,
    repositoryDid: playerDid,
  });

  const sigBytes = await signingKey.sign(cid.bytes);
  const attestationCid = cid.toString();

  const inlineSig: InlineSignature = {
    $type: `${NSIDS.Defs}#inlineSignature`,
    key: resolvedKeyId,
    issuer: issuerDid,
    issuedAt,
    cid: attestationCid,
    signature: { $bytes: toString(sigBytes, 'base64') },
  };

  return { signature: inlineSig, attestationCid };
}

/**
 * Build and cryptographically sign a `games.opengaming.achievement.unlock` record for a player.
 */
export async function createSignedUnlock({
  achievement,
  playerDid,
  issuerDid,
  signingKey,
  game,
  definitionCid,
  stepsCompleted,
  unlockedAt = new Date().toISOString(),
  keyId,
}: {
  achievement: string;
  playerDid: string;
  issuerDid: string;
  signingKey: Keypair;
  game?: string;
  definitionCid?: string;
  stepsCompleted?: number;
  unlockedAt?: string;
  keyId?: string;
}): Promise<{ record: AchievementUnlockRecord; attestationCid: string }> {
  const unsigned = stripUndefinedShallow({
    $type: NSIDS.AchievementUnlock,
    achievement,
    definitionCid,
    game,
    player: playerDid,
    unlockedAt,
    stepsCompleted,
  }) as unknown as AchievementUnlockRecord;

  const { signature, attestationCid } = await createInlineSignature({
    record: unsigned as unknown as Record<string, unknown>,
    issuerDid,
    playerDid,
    signingKey,
    issuedAt: unlockedAt,
    keyId,
  });

  return {
    record: { ...unsigned, signatures: [signature] },
    attestationCid,
  };
}

/**
 * Build and cryptographically sign a `games.opengaming.achievement.progress` record for a player.
 */
export async function createSignedProgress({
  achievement,
  currentSteps,
  stepsNeeded,
  playerDid,
  issuerDid,
  signingKey,
  game,
  updatedAt = new Date().toISOString(),
  keyId,
}: {
  achievement: string;
  currentSteps: number;
  stepsNeeded?: number;
  playerDid: string;
  issuerDid: string;
  signingKey: Keypair;
  game?: string;
  updatedAt?: string;
  keyId?: string;
}): Promise<{ record: AchievementProgressRecord; attestationCid: string }> {
  const unsigned = stripUndefinedShallow({
    $type: NSIDS.AchievementProgress,
    achievement,
    game,
    currentSteps,
    stepsNeeded,
    updatedAt,
  }) as unknown as AchievementProgressRecord;

  const { signature, attestationCid } = await createInlineSignature({
    record: unsigned as unknown as Record<string, unknown>,
    issuerDid,
    playerDid,
    signingKey,
    issuedAt: updatedAt,
    keyId,
  });

  return {
    record: { ...unsigned, signatures: [signature] },
    attestationCid,
  };
}

/**
 * Build and cryptographically sign a `games.opengaming.leaderboard.score` record for a player.
 */
export async function createSignedScore({
  leaderboard,
  score,
  playerDid,
  issuerDid,
  signingKey,
  game,
  definitionCid,
  displayScore,
  tag,
  recordedAt = new Date().toISOString(),
  keyId,
}: {
  leaderboard: string;
  score: number;
  playerDid: string;
  issuerDid: string;
  signingKey: Keypair;
  game?: string;
  definitionCid?: string;
  displayScore?: string;
  tag?: string;
  recordedAt?: string;
  keyId?: string;
}): Promise<{ record: LeaderboardScoreRecord; attestationCid: string }> {
  const unsigned = stripUndefinedShallow({
    $type: NSIDS.LeaderboardScore,
    leaderboard,
    definitionCid,
    game,
    player: playerDid,
    score,
    displayScore,
    tag,
    recordedAt,
  }) as unknown as LeaderboardScoreRecord;

  const { signature, attestationCid } = await createInlineSignature({
    record: unsigned as unknown as Record<string, unknown>,
    issuerDid,
    playerDid,
    signingKey,
    issuedAt: recordedAt,
    keyId,
  });

  return {
    record: { ...unsigned, signatures: [signature] },
    attestationCid,
  };
}

function extractIssuerFromAtUri(atUri?: string): string | undefined {
  if (!atUri || !atUri.startsWith('at://')) return undefined;
  const host = atUri.slice('at://'.length).split('/')[0];
  return host?.startsWith('did:') ? host : undefined;
}

function extractSignatureBytes(sigField: InlineSignature['signature']): Uint8Array {
  if (sigField instanceof Uint8Array) {
    return sigField;
  }
  if (sigField && typeof sigField === 'object' && '$bytes' in sigField) {
    const raw = (sigField as { $bytes: string | Uint8Array }).$bytes;
    if (raw instanceof Uint8Array) return raw;
    // Support both padded and unpadded base64
    const normalized = raw.length % 4 === 0 ? raw : raw + '='.repeat(4 - (raw.length % 4));
    return fromString(normalized, 'base64');
  }
  throw new Error('Malformed signature field');
}

function extractDidKeyFromDidDoc(didDoc: Record<string, unknown>, issuerDid: string, keyId: string): string | undefined {
  const fragment = keyId.includes('#') ? `#${keyId.split('#')[1]}` : ATTESTATION_KEY_FRAGMENT;
  const bareFragment = fragment.slice(1);

  const vmList = didDoc.verificationMethod;
  if (Array.isArray(vmList)) {
    const match = vmList.find(
      (vm: any) => vm?.id === `${issuerDid}${fragment}` || vm?.id === fragment
    ) as { publicKeyMultibase?: string } | undefined;
    if (match?.publicKeyMultibase) {
      return match.publicKeyMultibase.startsWith('did:key:')
        ? match.publicKeyMultibase
        : `did:key:${match.publicKeyMultibase}`;
    }
  }

  const plcMethods = didDoc.verificationMethods as Record<string, string> | undefined;
  if (plcMethods && typeof plcMethods[bareFragment] === 'string') {
    const val = plcMethods[bareFragment];
    return val.startsWith('did:key:') ? val : `did:key:${val}`;
  }

  return undefined;
}

/**
 * Verify a Mode A inline-signed Open Gaming record (`achievement.unlock`, `achievement.progress`,
 * or `leaderboard.score`) AND check publisher `games.opengaming.revocation` rules.
 *
 * Security checks performed:
 * 1. If `record.player` is present, it MUST equal `playerDid` (the repository DID housing the record).
 * 2. Expected publisher DID is inferred from the `achievement` / `leaderboard` AT-URI (or `expectedIssuerDid`),
 *    ensuringGame B cannot forge signatures for Game A's achievements!
 * 3. Public signing key is resolved from the publisher's DID document (`#attestations`), or supplied via `publicDidKey` in offline tests.
 * 4. Repository-bound `attestationCid` is recomputed with `repository: playerDid` (defeating cross-repo replay).
 * 5. ECDSA signature is verified over `attestationCid` bytes.
 * 6. Checks both supplied `revocations` AND optional `checkRemoteRevocation` callback so revoked exploits are rejected.
 */
export async function verifyRecordAttestation({
  record,
  playerDid,
  recordUri,
  expectedIssuerDid,
  publicDidKey,
  revocations = [],
  checkRemoteRevocation,
  plcDirectoryUrl,
  resolveDidDoc,
}: {
  record: AchievementUnlockRecord | AchievementProgressRecord | LeaderboardScoreRecord | Record<string, unknown>;
  playerDid: string;
  recordUri?: string;
  expectedIssuerDid?: string;
  /** Optional explicit `did:key:z...` override (for unit tests or pre-cached keys). */
  publicDidKey?: string;
  revocations?: Array<RevocationRecord | RevocationWithOrigin>;
  /** Optional async O(1) PDS revocation lookup `(issuerDid, attestationCid) => RevocationRecord | null`. */
  checkRemoteRevocation?: (issuerDid: string, attestationCid: string) => Promise<RevocationRecord | null>;
  plcDirectoryUrl?: string;
  resolveDidDoc?: (did: string) => Promise<Record<string, unknown> | null>;
}): Promise<VerificationResult> {
  const rec = record as Record<string, unknown>;

  if (typeof rec.player === 'string' && rec.player !== playerDid) {
    return {
      verified: false,
      error: 'player_mismatch',
      message: `Record player "${rec.player}" does not match repository DID "${playerDid}".`,
    };
  }

  const sigs = rec.signatures as InlineSignature[] | undefined;
  if (!Array.isArray(sigs) || sigs.length === 0) {
    return {
      verified: false,
      error: 'missing_signatures',
      message: 'Record contains no inline attestation signatures.',
    };
  }

  const targetUri =
    typeof rec.achievement === 'string'
      ? rec.achievement
      : typeof rec.leaderboard === 'string'
        ? rec.leaderboard
        : undefined;
  const definitionPublisherDid = expectedIssuerDid ?? extractIssuerFromAtUri(targetUri);

  // Pick matching inline signature
  const sig = sigs.find((s) => {
    if (!s || typeof s.key !== 'string') return false;
    if (!definitionPublisherDid) return true;
    const keyDid = s.key.split('#')[0];
    return keyDid === definitionPublisherDid || s.issuer === definitionPublisherDid;
  });

  if (!sig) {
    return {
      verified: false,
      error: 'issuer_mismatch',
      message: `No signature found from expected game publisher "${definitionPublisherDid}".`,
      issuerDid: definitionPublisherDid,
    };
  }

  const keyDidPart = sig.key.split('#')[0];
  const issuerDid = sig.key.startsWith('did:key:')
    ? sig.issuer ?? definitionPublisherDid ?? keyDidPart
    : keyDidPart;

  if (definitionPublisherDid && issuerDid !== definitionPublisherDid) {
    return {
      verified: false,
      error: 'issuer_mismatch',
      message: `Signature issuer "${issuerDid}" does not match definition publisher "${definitionPublisherDid}".`,
      issuerDid,
    };
  }

  if (!issuerDid.startsWith('did:')) {
    return {
      verified: false,
      error: 'invalid_key_format',
      message: `Invalid signer key "${sig.key}".`,
    };
  }

  // Recompute repository-bound attestation CID
  const { signature: _sigBytes, cid: claimedCid, ...sigMeta } = sig;
  const computedCidObj = await computeAttestationCid({
    record: rec,
    metadata: sigMeta as SignatureMetadataInput,
    repositoryDid: playerDid,
  });
  const attestationCid = computedCidObj.toString();

  if (typeof claimedCid === 'string' && claimedCid !== attestationCid) {
    return {
      verified: false,
      error: 'cid_mismatch',
      message: `Claimed attestation CID "${claimedCid}" does not match recomputed CID "${attestationCid}".`,
      issuerDid,
      attestationCid,
    };
  }

  // Resolve public signing key
  let resolvedDidKey = publicDidKey;
  if (!resolvedDidKey) {
    if (sig.key.startsWith('did:key:')) {
      // Only accept bare did:key if no DID-doc publisher was expected (e.g. local dev)
      if (definitionPublisherDid && !definitionPublisherDid.startsWith('did:key:')) {
        return {
          verified: false,
          error: 'invalid_key_format',
          message: `Bare did:key cannot attest on behalf of "${definitionPublisherDid}" without DID document verificationMethod binding.`,
          issuerDid,
          attestationCid,
        };
      }
      resolvedDidKey = sig.key;
    } else {
      let didDoc: Record<string, unknown> | null = null;
      try {
        if (resolveDidDoc) {
          didDoc = await resolveDidDoc(issuerDid);
        } else {
          const resolver = new DidResolver({ plcUrl: plcDirectoryUrl });
          didDoc = (await resolver.resolveNoCheck(issuerDid)) as Record<string, unknown> | null;
        }
      } catch {
        return {
          verified: false,
          error: 'did_resolution_failed',
          message: `Failed to resolve DID document for "${issuerDid}".`,
          issuerDid,
          attestationCid,
        };
      }

      if (!didDoc) {
        return {
          verified: false,
          error: 'did_resolution_failed',
          message: `DID document not found for "${issuerDid}".`,
          issuerDid,
          attestationCid,
        };
      }

      resolvedDidKey = extractDidKeyFromDidDoc(didDoc, issuerDid, sig.key);
      if (!resolvedDidKey) {
        return {
          verified: false,
          error: 'missing_attestation_key',
          message: `No "${sig.key}" verification method found in DID document for "${issuerDid}".`,
          issuerDid,
          attestationCid,
        };
      }
    }
  }

  // Verify ECDSA signature over CID bytes
  try {
    const sigBytes = extractSignatureBytes(sig.signature);
    const isValidSig = await verifySignature(resolvedDidKey, computedCidObj.bytes, sigBytes);
    if (!isValidSig) {
      return {
        verified: false,
        error: 'invalid_signature',
        message: 'Cryptographic signature verification failed.',
        issuerDid,
        attestationCid,
      };
    }
  } catch {
    return {
      verified: false,
      error: 'invalid_signature',
      message: 'Failed to decode or verify ECDSA signature bytes.',
      issuerDid,
      attestationCid,
    };
  }

  // Check local/indexed revocations
  const matchingRevocation = isRecordRevoked({
    attestationCid,
    playerDid,
    record: rec,
    recordUri,
    issuerDid,
    revocations,
  });
  if (matchingRevocation) {
    return {
      verified: false,
      error: 'revoked',
      message: `Attestation was revoked by publisher (${matchingRevocation.reason}).`,
      issuerDid,
      attestationCid,
      revocation: matchingRevocation,
    };
  }

  // Optional live O(1) PDS revocation lookup by rkey = attestationCid
  if (checkRemoteRevocation) {
    const remoteRev = await checkRemoteRevocation(issuerDid, attestationCid);
    if (remoteRev) {
      return {
        verified: false,
        error: 'revoked',
        message: `Attestation was revoked on publisher PDS (${remoteRev.reason}).`,
        issuerDid,
        attestationCid,
        revocation: remoteRev,
      };
    }
  }

  return {
    verified: true,
    issuerDid,
    keyId: sig.key,
    attestationCid,
  };
}
