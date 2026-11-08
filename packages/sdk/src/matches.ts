import { verifySignature, type Keypair } from '@atproto/crypto';
import { DidResolver } from '@atproto/identity';
import { NSIDS } from './constants.js';
import {
  computeAttestationCid,
  createInlineSignature,
  extractDidKeyFromDidDoc,
  extractIssuerFromAtUri,
  extractRkeyFromAtUri,
  extractSignatureBytes,
  stripUndefinedShallow,
  verifyRecordAttestation,
  type SignatureMetadataInput,
} from './attestation.js';
import { findInvalidatingLabels } from './labels.js';
import { isRecordRevoked } from './revocation.js';
import type {
  AtprotoLabel,
  BlobRef,
  InlineSignature,
  MatchDetails,
  MatchParticipant,
  MatchResultRecord,
  RevocationRecord,
  RevocationWithOrigin,
  StringMap,
  VerificationResult,
} from './types.js';

/**
 * Build and cryptographically sign a `games.opengaming.match.result` record for `repositoryDid`.
 * May be signed by a game publisher / tournament host OR by the first participant in a serverless
 * peer-to-peer match (followed by `coSignMatchResult` from each opposing participant).
 */
export async function createSignedMatchResult({
  game,
  participants,
  repositoryDid,
  issuerDid,
  signingKey,
  matchId,
  leaderboard,
  challenge,
  mode,
  bestOf,
  durationMs,
  dimensions,
  details,
  version,
  replay,
  playedAt = new Date().toISOString(),
  rkey,
  keyId,
}: {
  game: string;
  participants: MatchParticipant[];
  repositoryDid: string;
  issuerDid: string;
  signingKey: Keypair;
  matchId?: string;
  leaderboard?: string;
  challenge?: string;
  mode?: string;
  bestOf?: number;
  durationMs?: number;
  dimensions?: StringMap;
  details?: MatchDetails;
  version?: string;
  replay?: BlobRef;
  playedAt?: string;
  rkey?: string;
  keyId?: string;
}): Promise<{ record: MatchResultRecord; attestationCid: string }> {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new Error('createSignedMatchResult requires at least 2 participants.');
  }

  const unsigned = stripUndefinedShallow({
    $type: NSIDS.MatchResult,
    game,
    matchId,
    leaderboard,
    challenge,
    mode,
    bestOf,
    durationMs,
    participants,
    dimensions,
    details,
    version,
    replay,
    playedAt,
  }) as unknown as MatchResultRecord;

  const { signature, attestationCid } = await createInlineSignature({
    record: unsigned as unknown as Record<string, unknown>,
    issuerDid,
    playerDid: repositoryDid,
    signingKey,
    issuedAt: playedAt,
    rkey,
    keyId,
  });

  return {
    record: { ...unsigned, signatures: [signature] },
    attestationCid,
  };
}

/**
 * Append an additional inline signature to an existing `MatchResultRecord` (used for serverless
 * peer-to-peer PvP co-signing where every participant DID signs the `repositoryDid`-bound match receipt).
 */
export async function coSignMatchResult({
  record,
  repositoryDid,
  signerDid,
  signingKey,
  issuedAt = new Date().toISOString(),
  rkey,
  keyId,
}: {
  record: MatchResultRecord;
  repositoryDid: string;
  signerDid: string;
  signingKey: Keypair;
  issuedAt?: string;
  rkey?: string;
  keyId?: string;
}): Promise<{ record: MatchResultRecord; signature: InlineSignature; attestationCid: string }> {
  const { signature, attestationCid } = await createInlineSignature({
    record: record as unknown as Record<string, unknown>,
    issuerDid: signerDid,
    playerDid: repositoryDid,
    signingKey,
    issuedAt,
    rkey,
    keyId,
  });

  const existingSigs = Array.isArray(record.signatures)
    ? record.signatures.filter((s) => s.issuer !== signerDid && s.key.split('#')[0] !== signerDid)
    : [];

  return {
    record: {
      ...record,
      signatures: [...existingSigs, signature],
    },
    signature,
    attestationCid,
  };
}

/**
 * Verify a `games.opengaming.match.result` record stored in `repositoryDid`.
 *
 * Verification succeeds if:
 * 1. Signed by the game publisher (`game` DID) or an authorized `trustedIssuerDids` host, OR
 * 2. (`allowParticipantCoSigning`, default `true`): Co-signed in `signatures[]` by **every**
 *    distinct ATProto DID in `participants[]` (`>= 2` DIDs, including `repositoryDid`), enabling
 *    trustless serverless 1v1 / lobby match verification!
 * 3. (`allowCommunityLabelVerification`): Carries a `verified-replay` label from a trusted Labeler.
 */
export async function verifyMatchResult({
  record,
  repositoryDid,
  recordUri,
  recordCid,
  expectedIssuerDid,
  trustedIssuerDids,
  allowParticipantCoSigning = true,
  allowAnyValidIssuer = false,
  allowCommunityLabelVerification = false,
  participantDidKeys,
  revocations = [],
  activeLabels = [],
  trustedLabelerDids,
  plcDirectoryUrl,
  resolveDidDoc,
}: {
  record: MatchResultRecord;
  repositoryDid: string;
  recordUri?: string;
  recordCid?: string;
  expectedIssuerDid?: string;
  trustedIssuerDids?: string[];
  allowParticipantCoSigning?: boolean;
  allowAnyValidIssuer?: boolean;
  allowCommunityLabelVerification?: boolean;
  /** Optional map of `did -> did:key:z...` for unit tests or pre-cached participant keys. */
  participantDidKeys?: Record<string, string>;
  revocations?: Array<RevocationRecord | RevocationWithOrigin>;
  activeLabels?: AtprotoLabel[];
  trustedLabelerDids?: string[];
  plcDirectoryUrl?: string;
  resolveDidDoc?: (did: string) => Promise<Record<string, unknown> | null>;
}): Promise<VerificationResult> {
  // Check moderation labels upfront
  if (activeLabels.length > 0) {
    const blockingLabels = findInvalidatingLabels({
      recordUri,
      recordCid,
      playerDid: repositoryDid,
      activeLabels,
      trustedLabelerDids,
    });
    if (blockingLabels.length > 0) {
      const summary = blockingLabels.map((l) => `${l.val} (by ${l.src})`).join(', ');
      return {
        verified: false,
        error: 'label_invalidated',
        message: `Match result invalidated by moderation label: ${summary}.`,
        labels: blockingLabels,
      };
    }
  }

  // 1. Try standard publisher / tournament-host / community-label verification first
  const publisherCheck = await verifyRecordAttestation({
    record,
    playerDid: repositoryDid,
    recordUri,
    recordCid,
    expectedIssuerDid,
    trustedIssuerDids,
    allowAnyValidIssuer,
    allowCommunityLabelVerification,
    revocations,
    activeLabels,
    trustedLabelerDids,
    plcDirectoryUrl,
    resolveDidDoc,
  });

  if (publisherCheck.verified || publisherCheck.error === 'revoked' || publisherCheck.error === 'label_invalidated') {
    return publisherCheck;
  }

  if (!allowParticipantCoSigning) {
    return publisherCheck;
  }

  // 2. Peer-to-peer multi-participant DID co-signing verification
  const participants = Array.isArray(record.participants) ? record.participants : [];
  const participantDids = [
    ...new Set(
      participants
        .map((p) => p?.did)
        .filter((d): d is string => typeof d === 'string' && d.startsWith('did:'))
    ),
  ];

  if (participantDids.length < 2 || !participantDids.includes(repositoryDid)) {
    return publisherCheck;
  }

  const sigs = Array.isArray(record.signatures) ? record.signatures : [];
  if (sigs.length < participantDids.length) {
    return {
      verified: false,
      error: 'missing_participant_signatures',
      message: `Peer-to-peer match verification requires signatures from all ${participantDids.length} participant DIDs (${participantDids.join(', ')}).`,
    };
  }

  const definitionPublisherDid =
    expectedIssuerDid ??
    extractIssuerFromAtUri(record.leaderboard ?? record.challenge ?? record.game);

  let primaryAttestationCid = '';
  let primaryKeyId = '';

  for (const participantDid of participantDids) {
    const sig = sigs.find(
      (s) =>
        s &&
        typeof s.key === 'string' &&
        (s.key.split('#')[0] === participantDid || s.issuer === participantDid)
    );
    if (!sig) {
      return {
        verified: false,
        error: 'missing_participant_signatures',
        message: `Missing co-signature from match participant "${participantDid}".`,
      };
    }

    if (typeof sig.rkey === 'string' && recordUri) {
      const actualRkey = extractRkeyFromAtUri(recordUri);
      if (actualRkey && actualRkey !== sig.rkey) {
        return {
          verified: false,
          error: 'rkey_mismatch',
          message: `Participant signature from "${participantDid}" is bound to rkey "${sig.rkey}", found "${actualRkey}".`,
          issuerDid: participantDid,
        };
      }
    }

    const { signature: _sigBytes, cid: claimedCid, ...sigMeta } = sig;
    const computedCid = await computeAttestationCid({
      record: record as unknown as Record<string, unknown>,
      metadata: sigMeta as SignatureMetadataInput,
      repositoryDid,
    });
    const cidStr = computedCid.toString();

    if (typeof claimedCid === 'string' && claimedCid !== cidStr) {
      return {
        verified: false,
        error: 'cid_mismatch',
        message: `Claimed CID "${claimedCid}" does not match recomputed CID "${cidStr}" for participant "${participantDid}".`,
        issuerDid: participantDid,
        attestationCid: cidStr,
      };
    }

    let resolvedDidKey = participantDidKeys?.[participantDid];
    if (!resolvedDidKey) {
      let didDoc: Record<string, unknown> | null = null;
      try {
        if (resolveDidDoc) {
          didDoc = await resolveDidDoc(participantDid);
        } else {
          const resolver = new DidResolver({ plcUrl: plcDirectoryUrl });
          didDoc = (await resolver.resolveNoCheck(participantDid)) as Record<string, unknown> | null;
        }
      } catch {
        return {
          verified: false,
          error: 'did_resolution_failed',
          message: `Failed to resolve DID document for participant "${participantDid}".`,
          issuerDid: participantDid,
          attestationCid: cidStr,
        };
      }
      if (!didDoc) {
        return {
          verified: false,
          error: 'did_resolution_failed',
          message: `DID document not found for participant "${participantDid}".`,
          issuerDid: participantDid,
          attestationCid: cidStr,
        };
      }
      resolvedDidKey = extractDidKeyFromDidDoc(didDoc, participantDid, sig.key);
      if (!resolvedDidKey) {
        return {
          verified: false,
          error: 'missing_attestation_key',
          message: `No "${sig.key}" verification method found in DID document for participant "${participantDid}".`,
          issuerDid: participantDid,
          attestationCid: cidStr,
        };
      }
    }

    try {
      const sigBytes = extractSignatureBytes(sig.signature);
      const ok = await verifySignature(resolvedDidKey, computedCid.bytes, sigBytes);
      if (!ok) {
        return {
          verified: false,
          error: 'invalid_signature',
          message: `Invalid co-signature from match participant "${participantDid}".`,
          issuerDid: participantDid,
          attestationCid: cidStr,
        };
      }
    } catch {
      return {
        verified: false,
        error: 'invalid_signature',
        message: `Failed decoding signature bytes for participant "${participantDid}".`,
        issuerDid: participantDid,
        attestationCid: cidStr,
      };
    }

    // Honor publisher revocations against any participant in the match
    const matchingRev = isRecordRevoked({
      attestationCid: cidStr,
      playerDid: participantDid,
      record: record as unknown as Record<string, unknown>,
      recordUri,
      issuerDid: definitionPublisherDid ?? participantDid,
      definitionPublisherDid,
      revocations,
    });
    if (matchingRev) {
      return {
        verified: false,
        error: 'revoked',
        message: `Match revoked by publisher (${matchingRev.reason}).`,
        issuerDid: participantDid,
        attestationCid: cidStr,
        revocation: matchingRev,
      };
    }

    if (participantDid === repositoryDid || !primaryAttestationCid) {
      primaryAttestationCid = cidStr;
      primaryKeyId = sig.key;
    }
  }

  return {
    verified: true,
    verificationMethod: 'multi-participant',
    issuerDid: repositoryDid,
    keyId: primaryKeyId,
    attestationCid: primaryAttestationCid,
    coSigners: participantDids,
  };
}
