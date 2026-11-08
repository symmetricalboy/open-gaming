import {
  NSIDS,
  verifyRecordAttestation,
  type AchievementDefinitionRecord,
  type AchievementProgressRecord,
  type AchievementUnlockRecord,
  type LeaderboardDefinitionRecord,
  type LeaderboardScoreRecord,
  type RevocationRecord,
  type RevocationWithOrigin,
} from '@opengaming/sdk';
import type { AppDatabase } from './db.js';
import type { IdentityService } from './identity.js';

export const WATCHED_COLLECTIONS = [
  'games.atmosphere.define',
  NSIDS.AchievementDefinition,
  NSIDS.LeaderboardDefinition,
  NSIDS.Revocation,
  NSIDS.AchievementUnlock,
  NSIDS.AchievementProgress,
  NSIDS.LeaderboardScore,
] as const;

export interface ParsedAtUri {
  uri: string;
  did: string;
  collection: string;
  rkey: string;
}

export function parseAtUri(uri: string): ParsedAtUri | null {
  if (!uri.startsWith('at://')) return null;
  const parts = uri.slice('at://'.length).split('/');
  if (parts.length < 3) return null;
  const [did, collection, ...rest] = parts;
  const rkey = rest.join('/');
  if (!did.startsWith('did:') || !collection || !rkey) return null;
  return { uri, did, collection, rkey };
}

function extractBlobInfo(blob: any): { cid?: string; mimeType?: string } {
  if (!blob || typeof blob !== 'object') return {};
  const link =
    typeof blob.ref?.$link === 'string'
      ? blob.ref.$link
      : typeof blob.ref?.toString === 'function' && blob.ref.toString() !== '[object Object]'
        ? blob.ref.toString()
        : typeof blob.cid === 'string'
          ? blob.cid
          : undefined;
  const mimeType = typeof blob.mimeType === 'string' ? blob.mimeType : undefined;
  return { cid: link, mimeType };
}

function makeBlobProxyUrl(did: string, cid?: string): string | null {
  if (!cid) return null;
  return `/api/blob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

export class OpenGamingIndexer {
  constructor(
    private db: AppDatabase,
    private identity: IdentityService
  ) {}

  getPublisherRevocations(publisherDid: string): RevocationWithOrigin[] {
    const rows = this.db
      .prepare('SELECT uri, publisher_did, raw_json FROM revocations WHERE publisher_did = ?')
      .all(publisherDid) as Array<{ uri: string; publisher_did: string; raw_json: string }>;

    return rows.map((r) => ({
      uri: r.uri,
      publisherDid: r.publisher_did,
      value: JSON.parse(r.raw_json) as RevocationRecord,
    }));
  }

  async indexRecord({
    uri,
    cid,
    record,
    isDemo = false,
    iconUrlOverride,
  }: {
    uri: string;
    cid?: string;
    record: Record<string, any>;
    isDemo?: boolean;
    iconUrlOverride?: string;
  }): Promise<{ indexed: boolean; collection?: string; verified?: boolean; revoked?: boolean; error?: string }> {
    const parsed = parseAtUri(uri);
    if (!parsed) {
      return { indexed: false, error: `Invalid AT-URI: ${uri}` };
    }

    const { did, collection, rkey } = parsed;
    const now = new Date().toISOString();
    const rawJson = JSON.stringify(record);

    // Ensure actor entry exists in SQLite (non-blocking cache lookup or lightweight insert)
    if (!this.identity.getCachedActor(did)) {
      this.identity.upsertActor({ did, isDemo });
    }

    switch (collection) {
      case 'games.atmosphere.define':
      case 'games.gamesgamesgamesgames.game': {
        const iconBlob = extractBlobInfo(record.icon ?? record.cover);
        const iconUrl = iconUrlOverride ?? makeBlobProxyUrl(did, iconBlob.cid);
        const devName =
          typeof record.developer?.name === 'string'
            ? record.developer.name
            : typeof record.publisher === 'string'
              ? record.publisher
              : null;
        const devDid = typeof record.developer?.did === 'string' ? record.developer.did : did;

        this.db
          .prepare(
            `INSERT INTO games (
               uri, publisher_did, rkey, cid, name, tagline, description, url,
               category, status, icon_url, icon_cid, icon_mime, developer_name, developer_did,
               raw_json, indexed_at, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               cid = excluded.cid,
               name = excluded.name,
               tagline = excluded.tagline,
               description = excluded.description,
               url = excluded.url,
               category = excluded.category,
               status = excluded.status,
               icon_url = COALESCE(excluded.icon_url, games.icon_url),
               icon_cid = excluded.icon_cid,
               icon_mime = excluded.icon_mime,
               developer_name = excluded.developer_name,
               developer_did = excluded.developer_did,
               raw_json = excluded.raw_json,
               indexed_at = excluded.indexed_at`
          )
          .run(
            uri,
            did,
            rkey,
            cid ?? null,
            String(record.name ?? record.title ?? rkey),
            record.tagline ? String(record.tagline) : null,
            record.description ? String(record.description) : null,
            record.url ? String(record.url) : null,
            record.category ? String(record.category) : null,
            record.status ? String(record.status) : 'live',
            iconUrl,
            iconBlob.cid ?? null,
            iconBlob.mimeType ?? null,
            devName,
            devDid,
            rawJson,
            now,
            isDemo ? 1 : 0
          );

        return { indexed: true, collection };
      }

      case NSIDS.AchievementDefinition: {
        const def = record as AchievementDefinitionRecord;
        if (!def.game || !def.title || !def.description) {
          return { indexed: false, collection, error: 'Missing required achievement.definition fields' };
        }
        const iconBlob = extractBlobInfo(def.icon);
        const lockedBlob = extractBlobInfo(def.lockedIcon);
        const iconUrl = iconUrlOverride ?? makeBlobProxyUrl(did, iconBlob.cid);

        this.db
          .prepare(
            `INSERT INTO achievement_definitions (
               uri, publisher_did, rkey, cid, game_uri, title, description, requirement,
               icon_url, icon_cid, icon_mime, icon_alt, locked_icon_cid, locked_icon_mime,
               tier, hidden, steps_needed, group_name, list_order, badge_uri, created_at,
               raw_json, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               cid = excluded.cid,
               game_uri = excluded.game_uri,
               title = excluded.title,
               description = excluded.description,
               requirement = excluded.requirement,
               icon_url = COALESCE(excluded.icon_url, achievement_definitions.icon_url),
               icon_cid = excluded.icon_cid,
               icon_mime = excluded.icon_mime,
               icon_alt = excluded.icon_alt,
               locked_icon_cid = excluded.locked_icon_cid,
               locked_icon_mime = excluded.locked_icon_mime,
               tier = excluded.tier,
               hidden = excluded.hidden,
               steps_needed = excluded.steps_needed,
               group_name = excluded.group_name,
               list_order = excluded.list_order,
               badge_uri = excluded.badge_uri,
               raw_json = excluded.raw_json`
          )
          .run(
            uri,
            did,
            rkey,
            cid ?? null,
            def.game,
            def.title,
            def.description,
            def.requirement ?? null,
            iconUrl,
            iconBlob.cid ?? null,
            iconBlob.mimeType ?? null,
            def.iconAlt ?? null,
            lockedBlob.cid ?? null,
            lockedBlob.mimeType ?? null,
            def.tier ?? null,
            def.hidden ? 1 : 0,
            typeof def.stepsNeeded === 'number' ? Math.trunc(def.stepsNeeded) : null,
            def.group ?? null,
            typeof def.listOrder === 'number' ? Math.trunc(def.listOrder) : null,
            def.badge ?? null,
            def.createdAt ?? now,
            rawJson,
            isDemo ? 1 : 0
          );

        return { indexed: true, collection };
      }

      case NSIDS.LeaderboardDefinition: {
        const def = record as LeaderboardDefinitionRecord;
        if (!def.game || !def.name || !def.sortOrder || !def.scoreFormat || !def.timeframes || !def.recordPolicy) {
          return { indexed: false, collection, error: 'Missing required leaderboard.definition fields' };
        }
        const iconBlob = extractBlobInfo(def.icon);
        const iconUrl = iconUrlOverride ?? makeBlobProxyUrl(did, iconBlob.cid);

        this.db
          .prepare(
            `INSERT INTO leaderboard_definitions (
               uri, publisher_did, rkey, cid, game_uri, name, description,
               icon_url, icon_cid, icon_mime, icon_alt, sort_order, score_format_json,
               timeframes_json, record_policy, score_min, score_max, list_order,
               created_at, raw_json, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               cid = excluded.cid,
               game_uri = excluded.game_uri,
               name = excluded.name,
               description = excluded.description,
               icon_url = COALESCE(excluded.icon_url, leaderboard_definitions.icon_url),
               icon_cid = excluded.icon_cid,
               icon_mime = excluded.icon_mime,
               icon_alt = excluded.icon_alt,
               sort_order = excluded.sort_order,
               score_format_json = excluded.score_format_json,
               timeframes_json = excluded.timeframes_json,
               record_policy = excluded.record_policy,
               score_min = excluded.score_min,
               score_max = excluded.score_max,
               list_order = excluded.list_order,
               raw_json = excluded.raw_json`
          )
          .run(
            uri,
            did,
            rkey,
            cid ?? null,
            def.game,
            def.name,
            def.description ?? null,
            iconUrl,
            iconBlob.cid ?? null,
            iconBlob.mimeType ?? null,
            def.iconAlt ?? null,
            def.sortOrder,
            JSON.stringify(def.scoreFormat),
            JSON.stringify(def.timeframes),
            def.recordPolicy,
            typeof def.scoreMin === 'number' ? Math.trunc(def.scoreMin) : null,
            typeof def.scoreMax === 'number' ? Math.trunc(def.scoreMax) : null,
            typeof def.listOrder === 'number' ? Math.trunc(def.listOrder) : null,
            def.createdAt ?? now,
            rawJson,
            isDemo ? 1 : 0
          );

        return { indexed: true, collection };
      }

      case NSIDS.AchievementUnlock: {
        return this.indexUnlockRecord({ uri, did, rkey, record: record as AchievementUnlockRecord, isDemo, now });
      }

      case NSIDS.AchievementProgress: {
        const prog = record as AchievementProgressRecord;
        if (!prog.achievement || typeof prog.currentSteps !== 'number') {
          return { indexed: false, collection, error: 'Invalid achievement.progress record' };
        }
        const achParsed = parseAtUri(prog.achievement);
        let verified = 0;
        let attestationCid: string | null = null;

        if (Array.isArray(prog.signatures) && prog.signatures.length > 0 && achParsed) {
          const revocations = this.getPublisherRevocations(achParsed.did);
          const v = await verifyRecordAttestation({
            record: prog,
            playerDid: did,
            recordUri: uri,
            expectedIssuerDid: achParsed.did,
            revocations,
            resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
          });
          if (v.verified) {
            verified = 1;
            attestationCid = v.attestationCid;
          }
        }

        const defRow = this.db
          .prepare('SELECT game_uri, steps_needed FROM achievement_definitions WHERE uri = ?')
          .get(prog.achievement) as { game_uri?: string; steps_needed?: number } | undefined;

        this.db
          .prepare(
            `INSERT INTO achievement_progress (
               uri, player_did, rkey, achievement_uri, game_uri, current_steps, steps_needed,
               updated_at, verified, attestation_cid, raw_json, indexed_at, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               current_steps = excluded.current_steps,
               steps_needed = excluded.steps_needed,
               updated_at = excluded.updated_at,
               verified = excluded.verified,
               attestation_cid = excluded.attestation_cid,
               raw_json = excluded.raw_json,
               indexed_at = excluded.indexed_at`
          )
          .run(
            uri,
            did,
            rkey,
            prog.achievement,
            prog.game ?? defRow?.game_uri ?? null,
            Math.max(0, Math.trunc(prog.currentSteps)),
            prog.stepsNeeded ?? defRow?.steps_needed ?? null,
            prog.updatedAt ?? now,
            verified,
            attestationCid,
            rawJson,
            now,
            isDemo ? 1 : 0
          );

        return { indexed: true, collection, verified: verified === 1 };
      }

      case NSIDS.LeaderboardScore: {
        return this.indexScoreRecord({ uri, did, rkey, record: record as LeaderboardScoreRecord, isDemo, now });
      }

      case NSIDS.Revocation: {
        const rev = record as RevocationRecord;
        if (!rev.scope || !rev.player || !rev.subject || !rev.reason) {
          return { indexed: false, collection, error: 'Missing required revocation fields' };
        }
        const subjectParsed = parseAtUri(rev.subject);
        // Publisher authority check: publisher DID must match subject's DID!
        if (!subjectParsed || subjectParsed.did !== did) {
          return { indexed: false, collection, error: 'Revocation publisher DID does not own subject URI' };
        }

        this.db
          .prepare(
            `INSERT INTO revocations (
               uri, publisher_did, rkey, scope, attestation_cid, player_did, subject_uri,
               record_uri, before_ts, reason, note, revoked_at, raw_json, indexed_at, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               scope = excluded.scope,
               attestation_cid = excluded.attestation_cid,
               player_did = excluded.player_did,
               subject_uri = excluded.subject_uri,
               record_uri = excluded.record_uri,
               before_ts = excluded.before_ts,
               reason = excluded.reason,
               note = excluded.note,
               revoked_at = excluded.revoked_at,
               raw_json = excluded.raw_json,
               indexed_at = excluded.indexed_at`
          )
          .run(
            uri,
            did,
            rkey,
            rev.scope,
            rev.attestationCid ?? null,
            rev.player,
            rev.subject,
            rev.recordUri ?? null,
            rev.before ?? null,
            rev.reason,
            rev.note ?? null,
            rev.revokedAt ?? now,
            rawJson,
            now,
            isDemo ? 1 : 0
          );

        // Immediately re-evaluate stored unlocks & scores for this publisher!
        await this.revalidatePublisherRecords(did);
        return { indexed: true, collection };
      }

      default:
        return { indexed: false, collection };
    }
  }

  private async indexUnlockRecord({
    uri,
    did,
    rkey,
    record,
    isDemo,
    now,
  }: {
    uri: string;
    did: string;
    rkey: string;
    record: AchievementUnlockRecord;
    isDemo: boolean;
    now: string;
  }): Promise<{ indexed: boolean; collection: string; verified: boolean; revoked: boolean; error?: string }> {
    if (!record.achievement || !record.unlockedAt) {
      return {
        indexed: false,
        collection: NSIDS.AchievementUnlock,
        verified: false,
        revoked: false,
        error: 'Missing achievement or unlockedAt',
      };
    }

    const achParsed = parseAtUri(record.achievement);
    const publisherDid = achParsed?.did;
    const revocations = publisherDid ? this.getPublisherRevocations(publisherDid) : [];

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      expectedIssuerDid: publisherDid,
      revocations,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const defRow = this.db
      .prepare('SELECT game_uri FROM achievement_definitions WHERE uri = ?')
      .get(record.achievement) as { game_uri?: string } | undefined;

    const isVerified = verification.verified ? 1 : 0;
    const isRevoked = !verification.verified && verification.error === 'revoked' ? 1 : 0;
    const revocationReason = !verification.verified ? verification.revocation?.reason ?? null : null;
    const verificationError = !verification.verified ? verification.error : null;
    const verificationMessage = !verification.verified ? verification.message : null;
    const issuerDid = verification.issuerDid ?? publisherDid ?? null;
    const keyId = verification.verified ? verification.keyId : record.signatures?.[0]?.key ?? null;
    const attestationCid = verification.attestationCid ?? record.signatures?.[0]?.cid ?? null;

    this.db
      .prepare(
        `INSERT INTO achievement_unlocks (
           uri, player_did, rkey, achievement_uri, game_uri, unlocked_at, steps_completed,
           verified, verification_error, verification_message, issuer_did, key_id,
           attestation_cid, revoked, revocation_reason, raw_json, indexed_at, is_demo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           achievement_uri = excluded.achievement_uri,
           game_uri = COALESCE(excluded.game_uri, achievement_unlocks.game_uri),
           unlocked_at = excluded.unlocked_at,
           steps_completed = excluded.steps_completed,
           verified = excluded.verified,
           verification_error = excluded.verification_error,
           verification_message = excluded.verification_message,
           issuer_did = excluded.issuer_did,
           key_id = excluded.key_id,
           attestation_cid = excluded.attestation_cid,
           revoked = excluded.revoked,
           revocation_reason = excluded.revocation_reason,
           raw_json = excluded.raw_json,
           indexed_at = excluded.indexed_at`
      )
      .run(
        uri,
        did,
        rkey,
        record.achievement,
        record.game ?? defRow?.game_uri ?? null,
        record.unlockedAt,
        typeof record.stepsCompleted === 'number' ? Math.trunc(record.stepsCompleted) : null,
        isVerified,
        verificationError,
        verificationMessage,
        issuerDid,
        keyId,
        attestationCid,
        isRevoked,
        revocationReason,
        JSON.stringify(record),
        now,
        isDemo ? 1 : 0
      );

    return {
      indexed: true,
      collection: NSIDS.AchievementUnlock,
      verified: isVerified === 1,
      revoked: isRevoked === 1,
      error: verificationError ?? undefined,
    };
  }

  private async indexScoreRecord({
    uri,
    did,
    rkey,
    record,
    isDemo,
    now,
  }: {
    uri: string;
    did: string;
    rkey: string;
    record: LeaderboardScoreRecord;
    isDemo: boolean;
    now: string;
  }): Promise<{ indexed: boolean; collection: string; verified: boolean; revoked: boolean; error?: string }> {
    if (!record.leaderboard || typeof record.score !== 'number' || !Number.isInteger(record.score) || !record.recordedAt) {
      return {
        indexed: false,
        collection: NSIDS.LeaderboardScore,
        verified: false,
        revoked: false,
        error: 'Missing leaderboard, integer score, or recordedAt',
      };
    }

    const lbParsed = parseAtUri(record.leaderboard);
    const publisherDid = lbParsed?.did;
    const revocations = publisherDid ? this.getPublisherRevocations(publisherDid) : [];

    const defRow = this.db
      .prepare('SELECT game_uri, score_min, score_max FROM leaderboard_definitions WHERE uri = ?')
      .get(record.leaderboard) as { game_uri?: string; score_min?: number | null; score_max?: number | null } | undefined;

    const outOfBounds =
      (defRow?.score_min !== null && defRow?.score_min !== undefined && record.score < defRow.score_min) ||
      (defRow?.score_max !== null && defRow?.score_max !== undefined && record.score > defRow.score_max);

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      expectedIssuerDid: publisherDid,
      revocations,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const isVerified = verification.verified && !outOfBounds ? 1 : 0;
    const isRevoked = !verification.verified && verification.error === 'revoked' ? 1 : 0;
    const revocationReason = !verification.verified ? verification.revocation?.reason ?? null : null;
    const verificationError = outOfBounds
      ? 'out_of_bounds'
      : !verification.verified
        ? verification.error
        : null;
    const verificationMessage = outOfBounds
      ? `Score ${record.score} falls outside leaderboard bounds [${defRow?.score_min ?? '-∞'}, ${defRow?.score_max ?? '+∞'}].`
      : !verification.verified
        ? verification.message
        : null;
    const issuerDid = verification.issuerDid ?? publisherDid ?? null;
    const keyId = verification.verified ? verification.keyId : record.signatures?.[0]?.key ?? null;
    const attestationCid = verification.attestationCid ?? record.signatures?.[0]?.cid ?? null;

    this.db
      .prepare(
        `INSERT INTO leaderboard_scores (
           uri, player_did, rkey, leaderboard_uri, game_uri, score, display_score, tag,
           recorded_at, verified, verification_error, verification_message, issuer_did,
           key_id, attestation_cid, revoked, revocation_reason, raw_json, indexed_at, is_demo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           leaderboard_uri = excluded.leaderboard_uri,
           game_uri = COALESCE(excluded.game_uri, leaderboard_scores.game_uri),
           score = excluded.score,
           display_score = excluded.display_score,
           tag = excluded.tag,
           recorded_at = excluded.recorded_at,
           verified = excluded.verified,
           verification_error = excluded.verification_error,
           verification_message = excluded.verification_message,
           issuer_did = excluded.issuer_did,
           key_id = excluded.key_id,
           attestation_cid = excluded.attestation_cid,
           revoked = excluded.revoked,
           revocation_reason = excluded.revocation_reason,
           raw_json = excluded.raw_json,
           indexed_at = excluded.indexed_at`
      )
      .run(
        uri,
        did,
        rkey,
        record.leaderboard,
        record.game ?? defRow?.game_uri ?? null,
        record.score,
        record.displayScore ?? null,
        record.tag ?? null,
        record.recordedAt,
        isVerified,
        verificationError,
        verificationMessage,
        issuerDid,
        keyId,
        attestationCid,
        isRevoked,
        revocationReason,
        JSON.stringify(record),
        now,
        isDemo ? 1 : 0
      );

    return {
      indexed: true,
      collection: NSIDS.LeaderboardScore,
      verified: isVerified === 1,
      revoked: isRevoked === 1,
      error: verificationError ?? undefined,
    };
  }

  /**
   * Re-evaluate all stored unlocks & scores issued by `publisherDid` whenever a revocation
   * is added, updated, or deleted (`unrevoke`).
   */
  async revalidatePublisherRecords(publisherDid: string): Promise<void> {
    const unlocks = this.db
      .prepare('SELECT uri, player_did, rkey, raw_json, is_demo FROM achievement_unlocks WHERE issuer_did = ?')
      .all(publisherDid) as Array<{ uri: string; player_did: string; rkey: string; raw_json: string; is_demo: number }>;

    const now = new Date().toISOString();
    for (const u of unlocks) {
      await this.indexUnlockRecord({
        uri: u.uri,
        did: u.player_did,
        rkey: u.rkey,
        record: JSON.parse(u.raw_json) as AchievementUnlockRecord,
        isDemo: u.is_demo === 1,
        now,
      });
    }

    const scores = this.db
      .prepare('SELECT uri, player_did, rkey, raw_json, is_demo FROM leaderboard_scores WHERE issuer_did = ?')
      .all(publisherDid) as Array<{ uri: string; player_did: string; rkey: string; raw_json: string; is_demo: number }>;

    for (const s of scores) {
      await this.indexScoreRecord({
        uri: s.uri,
        did: s.player_did,
        rkey: s.rkey,
        record: JSON.parse(s.raw_json) as LeaderboardScoreRecord,
        isDemo: s.is_demo === 1,
        now,
      });
    }
  }

  /**
   * Delete a record from the AppView index (e.g. from Jetstream commit delete or unrevoke).
   */
  async deleteRecord(uri: string): Promise<boolean> {
    const parsed = parseAtUri(uri);
    if (!parsed) return false;

    const { did, collection } = parsed;
    switch (collection) {
      case 'games.atmosphere.define':
      case 'games.gamesgamesgamesgames.game':
        this.db.prepare('DELETE FROM games WHERE uri = ?').run(uri);
        return true;
      case NSIDS.AchievementDefinition:
        this.db.prepare('DELETE FROM achievement_definitions WHERE uri = ?').run(uri);
        return true;
      case NSIDS.LeaderboardDefinition:
        this.db.prepare('DELETE FROM leaderboard_definitions WHERE uri = ?').run(uri);
        return true;
      case NSIDS.AchievementUnlock:
        this.db.prepare('DELETE FROM achievement_unlocks WHERE uri = ?').run(uri);
        return true;
      case NSIDS.AchievementProgress:
        this.db.prepare('DELETE FROM achievement_progress WHERE uri = ?').run(uri);
        return true;
      case NSIDS.LeaderboardScore:
        this.db.prepare('DELETE FROM leaderboard_scores WHERE uri = ?').run(uri);
        return true;
      case NSIDS.Revocation:
        this.db.prepare('DELETE FROM revocations WHERE uri = ?').run(uri);
        await this.revalidatePublisherRecords(did);
        return true;
      default:
        return false;
    }
  }

  /**
   * On-demand repository sync: resolves any handle or DID, discovers its live PDS endpoint,
   * and backfills all Open Gaming & `games.atmosphere.define` collections.
   */
  async syncActorRepository(identifier: string): Promise<{
    did: string;
    handle?: string;
    pdsUrl: string;
    indexedCounts: Record<string, number>;
    totalIndexed: number;
  }> {
    const actor = await this.identity.resolveActor(identifier, true);
    if (!actor) {
      throw new Error(`Could not resolve ATProto actor "${identifier}".`);
    }

    const pdsUrl = actor.pdsUrl ?? 'https://bsky.social';
    const indexedCounts: Record<string, number> = {};
    let totalIndexed = 0;

    for (const collection of WATCHED_COLLECTIONS) {
      let cursor: string | undefined;
      let countForCollection = 0;

      for (let page = 0; page < 10; page++) {
        const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set('repo', actor.did);
        url.searchParams.set('collection', collection);
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url);
        if (!res.ok) break;

        const data = (await res.json()) as {
          records?: Array<{ uri: string; cid?: string; value: Record<string, unknown> }>;
          cursor?: string;
        };

        const records = data.records ?? [];
        for (const item of records) {
          const out = await this.indexRecord({
            uri: item.uri,
            cid: item.cid,
            record: item.value,
          });
          if (out.indexed) {
            countForCollection += 1;
            totalIndexed += 1;
          }
        }

        if (!data.cursor || records.length === 0) break;
        cursor = data.cursor;
      }

      if (countForCollection > 0) {
        indexedCounts[collection] = countForCollection;
      }
    }

    return {
      did: actor.did,
      handle: actor.handle,
      pdsUrl,
      indexedCounts,
      totalIndexed,
    };
  }
}
