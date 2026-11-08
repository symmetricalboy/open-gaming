import crypto from 'node:crypto';
import type { AtpAgent } from '@atproto/api';
import { NSIDS } from './constants.js';
import type { RevocationReason, RevocationRecord, RevocationScope, RevocationWithOrigin } from './types.js';

function extractDidFromAtUri(uri: string): string | undefined {
  if (!uri.startsWith('at://')) return undefined;
  const host = uri.slice('at://'.length).split('/')[0];
  return host?.startsWith('did:') ? host : undefined;
}

/**
 * Deterministic rkey for surgical single-attestation revocations (`scope: "attestation"`).
 * Using the `attestationCid` itself as the rkey enables O(1) direct `com.atproto.repo.getRecord`
 * checks on the game publisher's PDS without an external index.
 */
export function getAttestationRevocationRkey(attestationCid: string): string {
  const trimmed = attestationCid.trim();
  if (!trimmed) {
    throw new Error('attestationCid cannot be empty.');
  }
  return trimmed;
}

/**
 * Deterministic rkey for scoped player revocations (`achievement` | `leaderboard` | `game`).
 */
export function getScopedRevocationRkey({
  scope,
  player,
  subject,
}: {
  scope: Exclude<RevocationScope, 'attestation'>;
  player: string;
  subject: string;
}): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${scope}:${player}:${subject}`)
    .digest('hex')
    .slice(0, 24);
  return `rev-${scope}-${digest}`;
}

/**
 * Create a valid `games.opengaming.revocation` record and its deterministic `rkey`,
 * ready to write to the game publisher's PDS (`com.atproto.repo.putRecord`).
 */
export function createRevocationRecord({
  scope,
  player,
  subject,
  reason,
  attestationCid,
  recordUri,
  before,
  note,
  revokedAt = new Date().toISOString(),
}: {
  scope: RevocationScope;
  player: string;
  subject: string;
  reason: RevocationReason;
  attestationCid?: string;
  recordUri?: string;
  before?: string;
  note?: string;
  revokedAt?: string;
}): { rkey: string; record: RevocationRecord } {
  if (!player.startsWith('did:')) {
    throw new Error(`Invalid player DID: "${player}".`);
  }
  if (!subject.startsWith('at://')) {
    throw new Error(`Invalid subject AT-URI: "${subject}".`);
  }
  if (scope === 'attestation' && !attestationCid) {
    throw new Error('`attestationCid` is required when `scope` is "attestation".');
  }

  const record: RevocationRecord = {
    $type: NSIDS.Revocation,
    scope,
    ...(attestationCid ? { attestationCid } : {}),
    player,
    subject,
    ...(recordUri ? { recordUri } : {}),
    ...(before ? { before } : {}),
    reason,
    ...(note ? { note } : {}),
    revokedAt,
  };

  const rkey =
    scope === 'attestation'
      ? getAttestationRevocationRkey(attestationCid!)
      : getScopedRevocationRkey({ scope, player, subject });

  return { rkey, record };
}

/**
 * Publish a revocation record to the game publisher's repository via `putRecord`.
 */
export async function publishRevocation({
  agent,
  issuerDid,
  ...params
}: Parameters<typeof createRevocationRecord>[0] & {
  agent: AtpAgent;
  issuerDid: string;
}): Promise<{ uri: string; cid: string; rkey: string; record: RevocationRecord }> {
  const { rkey, record } = createRevocationRecord(params);
  const res = await agent.com.atproto.repo.putRecord({
    repo: issuerDid,
    collection: NSIDS.Revocation,
    rkey,
    record: record as unknown as Record<string, unknown>,
  });
  return {
    uri: res.data.uri,
    cid: res.data.cid,
    rkey,
    record,
  };
}

/**
 * Reinstate (un-revoke) a previously published revocation by deleting it from the publisher's PDS.
 */
export async function reinstateRevocation({
  agent,
  issuerDid,
  rkey,
}: {
  agent: AtpAgent;
  issuerDid: string;
  rkey: string;
}): Promise<void> {
  await agent.com.atproto.repo.deleteRecord({
    repo: issuerDid,
    collection: NSIDS.Revocation,
    rkey,
  });
}

/**
 * Perform an O(1) direct PDS check for a surgical `scope: "attestation"` revocation
 * stored at `at://<issuerDid>/games.opengaming.revocation/<attestationCid>`.
 */
export async function checkRevocationOnPds({
  pdsUrl,
  issuerDid,
  attestationCid,
}: {
  pdsUrl: string;
  issuerDid: string;
  attestationCid: string;
}): Promise<RevocationRecord | null> {
  const base = pdsUrl.replace(/\/$/, '');
  const url = `${base}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(
    issuerDid
  )}&collection=${encodeURIComponent(NSIDS.Revocation)}&rkey=${encodeURIComponent(attestationCid)}`;

  const res = await fetch(url);
  if (res.status === 404 || res.status === 400) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed checking PDS revocation (${res.status})`);
  }
  const body = (await res.json()) as { value?: RevocationRecord };
  if (body?.value?.$type === NSIDS.Revocation) {
    return body.value;
  }
  return null;
}

/**
 * Evaluate whether an unlock, progress, or score record is invalidated by any publisher/issuer revocation.
 *
 * Enforces authority: a revocation ONLY applies if it was published by either the DID that owns the
 * target definition (`definitionPublisherDid`) or the DID that signed the attestation (`issuerDid`).
 */
export function isRecordRevoked({
  attestationCid,
  playerDid,
  record,
  recordUri,
  issuerDid,
  definitionPublisherDid,
  revocations,
}: {
  attestationCid: string;
  playerDid: string;
  record: Record<string, unknown>;
  recordUri?: string;
  issuerDid: string;
  definitionPublisherDid?: string;
  revocations: Array<RevocationRecord | RevocationWithOrigin>;
}): RevocationRecord | null {
  const achievementUri = typeof record.achievement === 'string' ? record.achievement : undefined;
  const leaderboardUri = typeof record.leaderboard === 'string' ? record.leaderboard : undefined;
  const gameUri = typeof record.game === 'string' ? record.game : undefined;
  const recordTimestampStr =
    typeof record.unlockedAt === 'string'
      ? record.unlockedAt
      : typeof record.recordedAt === 'string'
        ? record.recordedAt
        : typeof record.updatedAt === 'string'
          ? record.updatedAt
          : undefined;
  const recordTimeMs = recordTimestampStr ? Date.parse(recordTimestampStr) : NaN;

  const authorizedPublishers = new Set<string>([issuerDid]);
  if (definitionPublisherDid) {
    authorizedPublishers.add(definitionPublisherDid);
  }
  const inferredTargetOwner = extractDidFromAtUri(achievementUri ?? leaderboardUri ?? gameUri ?? '');
  if (inferredTargetOwner) {
    authorizedPublishers.add(inferredTargetOwner);
  }

  for (const entry of revocations) {
    const isWrapped = 'value' in entry && 'publisherDid' in entry;
    const rev = isWrapped ? (entry as RevocationWithOrigin).value : (entry as RevocationRecord);
    const revOriginDid = isWrapped
      ? (entry as RevocationWithOrigin).publisherDid
      : extractDidFromAtUri(rev.subject);

    // Authority check: unrelated Studio B can never revoke Studio A's records
    if (!revOriginDid || !authorizedPublishers.has(revOriginDid)) {
      continue;
    }
    const subjectOwnerDid = extractDidFromAtUri(rev.subject);
    if (subjectOwnerDid && !authorizedPublishers.has(subjectOwnerDid)) {
      continue;
    }

    if (rev.player !== playerDid) {
      continue;
    }

    if (rev.scope === 'attestation') {
      if (rev.attestationCid && rev.attestationCid === attestationCid) {
        return rev;
      }
      if (recordUri && rev.recordUri && rev.recordUri === recordUri && !rev.attestationCid) {
        return rev;
      }
      continue;
    }

    // Check optional `before` cutoff on scoped revocations
    if (rev.before) {
      const cutoffMs = Date.parse(rev.before);
      if (Number.isFinite(cutoffMs) && Number.isFinite(recordTimeMs) && recordTimeMs > cutoffMs) {
        continue;
      }
    }

    if (rev.scope === 'achievement' && achievementUri && rev.subject === achievementUri) {
      return rev;
    }
    if (rev.scope === 'leaderboard' && leaderboardUri && rev.subject === leaderboardUri) {
      return rev;
    }
    if (rev.scope === 'game') {
      if (gameUri && rev.subject === gameUri) {
        return rev;
      }
      if (!gameUri && rev.subject.includes('/games.atmosphere.define/')) {
        return rev;
      }
    }
  }

  return null;
}
