import { encode as dagCborEncode, code as DAG_CBOR_CODEC } from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { verifySignature, type Keypair } from '@atproto/crypto';
import { DidResolver } from '@atproto/identity';
import { fromString, toString } from 'uint8arrays';
import { ATTESTATION_KEY_FRAGMENT, NSIDS } from './constants.js';
import { findInvalidatingLabels, findVerificationLabels } from './labels.js';
import { isRecordRevoked } from './revocation.js';
import type {
  AchievementProgressRecord,
  AchievementUnlockRecord,
  AtprotoLabel,
  BlobRef,
  InlineSignature,
  LeaderboardScoreRecord,
  RevocationRecord,
  RevocationWithOrigin,
  ScoreComponentValMap,
  ScoreDetails,
  VerificationResult,
} from './types.js';

export interface SignatureMetadataInput {
  $type: string;
  key: string;
  issuer?: string;
  issuedAt?: string;
  rkey?: string;
  [extra: string]: unknown;
}

function normalizeRecordValue(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return { $bytes: toString(value, 'base64') };
  }
  const asCid = CID.asCID(value);
  if (asCid) {
    return { $link: asCid.toString() };
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function' && !(value instanceof Date)) {
    return normalizeRecordValue((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map((v) => normalizeRecordValue(v));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = normalizeRecordValue(v);
    }
  }
  return out;
}

function assertNoUndefined(value: unknown, path = 'record'): void {
  if (value === undefined) {
    throw new Error(`Cannot DAG-CBOR encode: "${path}" is undefined.`);
  }
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array || CID.asCID(value)) {
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
 * 2. Strip `cid` and `signature` from the signature metadata, and inject `repository: playerDid`
 *    (plus `rkey` if included in signature metadata).
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

  const normalizedRecord = normalizeRecordValue(recordWithoutSigs) as Record<string, unknown>;

  const attestationPayload = stripUndefinedShallow({
    ...normalizedRecord,
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
  rkey,
  keyId,
}: {
  record: Record<string, unknown>;
  issuerDid: string;
  playerDid: string;
  signingKey: Keypair;
  issuedAt?: string;
  /** Optional target `rkey` binding so signed payloads cannot be moved to evade URI labels. */
  rkey?: string;
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
    rkey,
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
    ...(rkey ? { rkey } : {}),
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
  rkey,
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
  rkey?: string;
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
    rkey,
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
  definitionCid,
  playerDid,
  issuerDid,
  signingKey,
  game,
  updatedAt = new Date().toISOString(),
  rkey,
  keyId,
}: {
  achievement: string;
  currentSteps: number;
  stepsNeeded?: number;
  definitionCid?: string;
  playerDid: string;
  issuerDid: string;
  signingKey: Keypair;
  game?: string;
  updatedAt?: string;
  rkey?: string;
  keyId?: string;
}): Promise<{ record: AchievementProgressRecord; attestationCid: string }> {
  const unsigned = stripUndefinedShallow({
    $type: NSIDS.AchievementProgress,
    achievement,
    definitionCid,
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
    rkey,
    keyId,
  });

  return {
    record: { ...unsigned, signatures: [signature] },
    attestationCid,
  };
}

function inferHeadlineScoreFromComponents(components?: ScoreComponentValMap): number | undefined {
  if (!components || typeof components !== 'object' || Array.isArray(components)) return undefined;
  for (const comp of Object.values(components)) {
    if (comp && typeof comp.value === 'number' && Number.isInteger(comp.value)) {
      return comp.value;
    }
  }
  return undefined;
}

/**
 * Build and cryptographically sign a `games.opengaming.leaderboard.score` record for a player.
 * Supports single-integer `score`, multi-component `components` maps, genre `details`, `version`
 * hashes, and `replay` blobs.
 */
export async function createSignedScore({
  leaderboard,
  score,
  components,
  details,
  version,
  replay,
  playerDid,
  issuerDid,
  signingKey,
  game,
  definitionCid,
  displayScore,
  tag,
  recordedAt = new Date().toISOString(),
  rkey,
  keyId,
}: {
  leaderboard: string;
  score?: number;
  components?: ScoreComponentValMap;
  details?: ScoreDetails;
  version?: string;
  replay?: BlobRef;
  playerDid: string;
  issuerDid: string;
  signingKey: Keypair;
  game?: string;
  definitionCid?: string;
  displayScore?: string;
  tag?: string;
  recordedAt?: string;
  rkey?: string;
  keyId?: string;
}): Promise<{ record: LeaderboardScoreRecord; attestationCid: string }> {
  const effectiveScore = score ?? inferHeadlineScoreFromComponents(components);
  const hasComponents =
    components !== undefined &&
    typeof components === 'object' &&
    !Array.isArray(components) &&
    Object.keys(components).length > 0;
  if (effectiveScore === undefined && !hasComponents) {
    throw new Error('createSignedScore requires either `score` or at least one entry in `components`.');
  }

  const unsigned = stripUndefinedShallow({
    $type: NSIDS.LeaderboardScore,
    leaderboard,
    definitionCid,
    game,
    player: playerDid,
    score: effectiveScore,
    displayScore,
    components,
    details,
    version,
    replay,
    tag,
    recordedAt,
  }) as unknown as LeaderboardScoreRecord;

  const { signature, attestationCid } = await createInlineSignature({
    record: unsigned as unknown as Record<string, unknown>,
    issuerDid,
    playerDid,
    signingKey,
    issuedAt: recordedAt,
    rkey,
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

function extractRkeyFromAtUri(atUri?: string): string | undefined {
  if (!atUri || !atUri.startsWith('at://')) return undefined;
  const parts = atUri.slice('at://'.length).split('/');
  if (parts.length < 3) return undefined;
  return parts.slice(2).join('/') || undefined;
}

function extractSignatureBytes(sigField: InlineSignature['signature']): Uint8Array {
  if (sigField instanceof Uint8Array) {
    return sigField;
  }
  if (sigField && typeof sigField === 'object' && '$bytes' in sigField) {
    const raw = (sigField as { $bytes: string | Uint8Array }).$bytes;
    if (raw instanceof Uint8Array) return raw;
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
 * or `leaderboard.score`), supporting multi-issuer post-EoS federation (`trustedIssuerDids` /
 * `allowAnyValidIssuer`), `rkey` binding, publisher `games.opengaming.revocation` records, and
 * ATProto Labeler moderation (`activeLabels`).
 */
export async function verifyRecordAttestation({
  record,
  playerDid,
  recordUri,
  recordCid,
  expectedIssuerDid,
  trustedIssuerDids,
  allowAnyValidIssuer = false,
  allowCommunityLabelVerification = false,
  publicDidKey,
  revocations = [],
  activeLabels = [],
  trustedLabelerDids,
  checkRemoteRevocation,
  plcDirectoryUrl,
  resolveDidDoc,
}: {
  record: AchievementUnlockRecord | AchievementProgressRecord | LeaderboardScoreRecord | Record<string, unknown>;
  playerDid: string;
  recordUri?: string;
  recordCid?: string;
  expectedIssuerDid?: string;
  /** Optional list of additional trusted signer DIDs (e.g. federated tournament hosts or post-EoS revival servers). */
  trustedIssuerDids?: string[];
  /** When true, accepts valid cryptographic signatures from any resolvable issuer DID (open federation mode). */
  allowAnyValidIssuer?: boolean;
  /** When true, unsigned post-EoS records carrying a `verified-replay` / `community-verified` label from a trusted labeler verify as valid. */
  allowCommunityLabelVerification?: boolean;
  /** Optional explicit `did:key:z...` override (for unit tests or pre-cached keys). */
  publicDidKey?: string;
  revocations?: Array<RevocationRecord | RevocationWithOrigin>;
  /** Active ATProto `com.atproto.label.defs#label` entries for anti-cheat & community replay verification. */
  activeLabels?: AtprotoLabel[];
  /** Optional allowlist of trusted labeler DIDs. If omitted, all entries in `activeLabels` are trusted. */
  trustedLabelerDids?: string[];
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

  // Check anti-cheat moderation labels upfront (applies to both signed and unsigned records)
  if (activeLabels.length > 0) {
    const blockingLabels = findInvalidatingLabels({
      recordUri,
      recordCid,
      playerDid,
      activeLabels,
      trustedLabelerDids,
    });
    if (blockingLabels.length > 0) {
      const summary = blockingLabels.map((l) => `${l.val} (by ${l.src})`).join(', ');
      return {
        verified: false,
        error: 'label_invalidated',
        message: `Record invalidated by moderation label: ${summary}.`,
        labels: blockingLabels,
      };
    }
  }

  const targetUri =
    typeof rec.achievement === 'string'
      ? rec.achievement
      : typeof rec.leaderboard === 'string'
        ? rec.leaderboard
        : undefined;
  const definitionPublisherDid = expectedIssuerDid ?? extractIssuerFromAtUri(targetUri);

  const allowedIssuers = new Set<string>();
  if (definitionPublisherDid) allowedIssuers.add(definitionPublisherDid);
  if (trustedIssuerDids) {
    for (const d of trustedIssuerDids) {
      if (d) allowedIssuers.add(d);
    }
  }

  const sigs = rec.signatures as InlineSignature[] | undefined;
  if (!Array.isArray(sigs) || sigs.length === 0) {
    // Support post-EoS serverless replay verification via trusted ATProto Labelers!
    if (allowCommunityLabelVerification && activeLabels.length > 0 && recordUri) {
      const posLabels = findVerificationLabels({
        recordUri,
        recordCid,
        activeLabels,
        trustedLabelerDids,
      });
      if (posLabels.length > 0) {
        const labelerDid = posLabels[0].src;
        const unsignedCid = await computeAttestationCid({
          record: rec,
          metadata: {
            $type: `${NSIDS.Defs}#inlineSignature`,
            key: `label:${labelerDid}`,
            issuer: labelerDid,
          },
          repositoryDid: playerDid,
        });
        const attestationCid = unsignedCid.toString();

        // Still honor publisher revocations if any exist
        const matchingRev = isRecordRevoked({
          attestationCid,
          playerDid,
          record: rec,
          recordUri,
          issuerDid: definitionPublisherDid ?? labelerDid,
          definitionPublisherDid,
          revocations,
        });
        if (matchingRev) {
          return {
            verified: false,
            error: 'revoked',
            message: `Record was revoked (${matchingRev.reason}).`,
            issuerDid: labelerDid,
            attestationCid,
            revocation: matchingRev,
          };
        }

        return {
          verified: true,
          verificationMethod: 'community-label',
          issuerDid: labelerDid,
          keyId: `label:${labelerDid}#${posLabels[0].val}`,
          attestationCid,
        };
      }
    }

    return {
      verified: false,
      error: 'missing_signatures',
      message: 'Record contains no inline attestation signatures.',
    };
  }

  // Pick matching inline signature
  const sig = sigs.find((s) => {
    if (!s || typeof s.key !== 'string') return false;
    if (allowAnyValidIssuer || allowedIssuers.size === 0) return true;
    const keyDid = s.key.split('#')[0];
    return allowedIssuers.has(keyDid) || (typeof s.issuer === 'string' && allowedIssuers.has(s.issuer));
  });

  if (!sig) {
    const expectedDesc = [...allowedIssuers].join(', ');
    return {
      verified: false,
      error: 'issuer_mismatch',
      message: `No signature found from trusted authority (${expectedDesc}).`,
      issuerDid: definitionPublisherDid,
    };
  }

  const keyDidPart = sig.key.split('#')[0];
  const issuerDid = sig.key.startsWith('did:key:')
    ? sig.issuer ?? definitionPublisherDid ?? keyDidPart
    : keyDidPart;

  if (!allowAnyValidIssuer && allowedIssuers.size > 0 && !allowedIssuers.has(issuerDid)) {
    return {
      verified: false,
      error: 'issuer_mismatch',
      message: `Signature issuer "${issuerDid}" is not in trusted issuers (${[...allowedIssuers].join(', ')}).`,
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

  // Enforce optional `rkey` binding (defeats moving signed records to evade URI-targeted labels)
  if (typeof sig.rkey === 'string' && recordUri) {
    const actualRkey = extractRkeyFromAtUri(recordUri);
    if (actualRkey && actualRkey !== sig.rkey) {
      return {
        verified: false,
        error: 'rkey_mismatch',
        message: `Signature is bound to rkey "${sig.rkey}", but record was found at rkey "${actualRkey}".`,
        issuerDid,
      };
    }
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
      if (!allowAnyValidIssuer && allowedIssuers.size > 0 && ![...allowedIssuers].some((d) => d.startsWith('did:key:'))) {
        return {
          verified: false,
          error: 'invalid_key_format',
          message: `Bare did:key cannot attest on behalf of "${issuerDid}" without DID document verificationMethod binding.`,
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

  // Check local/indexed revocations (honoring both definition owner and signing issuer)
  const matchingRevocation = isRecordRevoked({
    attestationCid,
    playerDid,
    record: rec,
    recordUri,
    issuerDid,
    definitionPublisherDid,
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
    if (definitionPublisherDid && definitionPublisherDid !== issuerDid) {
      const defOwnerRev = await checkRemoteRevocation(definitionPublisherDid, attestationCid);
      if (defOwnerRev) {
        return {
          verified: false,
          error: 'revoked',
          message: `Attestation was revoked on game publisher PDS (${defOwnerRev.reason}).`,
          issuerDid,
          attestationCid,
          revocation: defOwnerRev,
        };
      }
    }
  }

  return {
    verified: true,
    verificationMethod: 'attestation',
    issuerDid,
    keyId: sig.key,
    attestationCid,
  };
}
