import {
  NSIDS,
  getRecordLabelValues,
  getScoreSortMetric,
  isWithinLeaderboardWindow,
  resolveActiveLabels,
  validateComponentDefs,
  validateDimensionDefs,
  validateScoreComponents,
  validateScoreDimensions,
  verifyMatchResult,
  verifyRecordAttestation,
  type AchievementDefinitionRecord,
  type AchievementProgressRecord,
  type AchievementUnlockRecord,
  type AtprotoLabel,
  type ChallengeDefinitionRecord,
  type LeaderboardDefinitionRecord,
  type LeaderboardScoreRecord,
  type MatchResultRecord,
  type RevocationRecord,
  type RevocationWithOrigin,
} from '@opengaming/sdk';
import type { AppDatabase } from './db.js';
import type { IdentityService } from './identity.js';

export const WATCHED_COLLECTIONS = [
  'games.atmosphere.define',
  NSIDS.AchievementDefinition,
  NSIDS.LeaderboardDefinition,
  NSIDS.ChallengeDefinition,
  NSIDS.Revocation,
  NSIDS.AchievementUnlock,
  NSIDS.AchievementProgress,
  NSIDS.LeaderboardScore,
  NSIDS.MatchResult,
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

  getPublisherRevocations(publisherDids: string | string[]): RevocationWithOrigin[] {
    const list = (Array.isArray(publisherDids) ? publisherDids : [publisherDids]).filter(Boolean);
    if (list.length === 0) return [];
    const placeholders = list.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT uri, publisher_did, raw_json FROM revocations WHERE publisher_did IN (${placeholders})`)
      .all(...list) as Array<{ uri: string; publisher_did: string; raw_json: string }>;

    return rows.map((r) => ({
      uri: r.uri,
      publisherDid: r.publisher_did,
      value: JSON.parse(r.raw_json) as RevocationRecord,
    }));
  }

  getActiveModerationLabels(targetUris?: string[]): AtprotoLabel[] {
    const rows =
      targetUris && targetUris.length > 0
        ? (this.db
            .prepare(
              `SELECT src, uri, cid, val, neg, cts, exp
               FROM moderation_labels
               WHERE uri IN (${targetUris.map(() => '?').join(', ')})`
            )
            .all(...targetUris) as Array<Record<string, any>>)
        : (this.db
            .prepare('SELECT src, uri, cid, val, neg, cts, exp FROM moderation_labels')
            .all() as Array<Record<string, any>>);

    const events: AtprotoLabel[] = rows.map((r) => ({
      src: String(r.src),
      uri: String(r.uri),
      ...(r.cid ? { cid: String(r.cid) } : {}),
      val: String(r.val),
      neg: Number(r.neg) === 1,
      cts: String(r.cts),
      ...(r.exp ? { exp: String(r.exp) } : {}),
    }));

    return resolveActiveLabels(events);
  }

  /**
   * Ingest an ATProto `com.atproto.label.defs#label` event (anti-cheat moderation or post-EoS
   * replay verification) and reactively re-evaluate affected player records.
   */
  async ingestLabel(label: AtprotoLabel): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO moderation_labels (src, uri, cid, val, neg, cts, exp, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(src, uri, cid, val) DO UPDATE SET
           neg = excluded.neg,
           cts = excluded.cts,
           exp = excluded.exp,
           indexed_at = excluded.indexed_at`
      )
      .run(
        label.src,
        label.uri,
        label.cid ?? '',
        label.val,
        label.neg ? 1 : 0,
        label.cts ?? now,
        label.exp ?? null,
        now
      );

    await this.revalidateLabeledRecords(label.uri);
  }

  async revalidateLabeledRecords(targetUriOrDid: string): Promise<void> {
    const now = new Date().toISOString();
    const isDid = targetUriOrDid.startsWith('did:');

    const unlocks = (
      isDid
        ? this.db
            .prepare('SELECT uri, player_did, rkey, raw_json, is_demo FROM achievement_unlocks WHERE player_did = ?')
            .all(targetUriOrDid)
        : this.db
            .prepare('SELECT uri, player_did, rkey, raw_json, is_demo FROM achievement_unlocks WHERE uri = ?')
            .all(targetUriOrDid)
    ) as Array<{ uri: string; player_did: string; rkey: string; raw_json: string; is_demo: number }>;

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

    const scores = (
      isDid
        ? this.db
            .prepare('SELECT uri, player_did, rkey, raw_json, is_demo FROM leaderboard_scores WHERE player_did = ?')
            .all(targetUriOrDid)
        : this.db
            .prepare('SELECT uri, player_did, rkey, raw_json, is_demo FROM leaderboard_scores WHERE uri = ?')
            .all(targetUriOrDid)
    ) as Array<{ uri: string; player_did: string; rkey: string; raw_json: string; is_demo: number }>;

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

    const matches = (
      isDid
        ? this.db
            .prepare(
              'SELECT uri, repository_did, rkey, cid, raw_json, is_demo FROM match_results WHERE repository_did = ? OR participants_json LIKE ?'
            )
            .all(targetUriOrDid, `%${targetUriOrDid}%`)
        : this.db
            .prepare('SELECT uri, repository_did, rkey, cid, raw_json, is_demo FROM match_results WHERE uri = ?')
            .all(targetUriOrDid)
    ) as Array<{
      uri: string;
      repository_did: string;
      rkey: string;
      cid?: string | null;
      raw_json: string;
      is_demo: number;
    }>;

    for (const m of matches) {
      await this.indexMatchRecord({
        uri: m.uri,
        cid: m.cid ?? undefined,
        did: m.repository_did,
        rkey: m.rkey,
        record: JSON.parse(m.raw_json) as MatchResultRecord,
        isDemo: m.is_demo === 1,
        now,
      });
    }
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
        if (!def.game) {
          return { indexed: false, collection, error: 'Missing required achievement.definition game field' };
        }
        // Non-hidden achievements must specify title and description; hidden stubs may omit them to prevent PDS spoiler leaks
        if (!def.hidden && (!def.title || !def.description)) {
          return { indexed: false, collection, error: 'Visible achievement.definition requires title and description' };
        }

        const isRedactedStub = Boolean(def.hidden && (!def.title || !def.description));
        const storedTitle = def.title ?? 'Hidden Achievement';
        const storedDesc =
          def.description ??
          (def.hiddenSpace
            ? 'Spoiler-protected stub — full achievement details unlock inside the game ATProto Space.'
            : 'Keep playing to discover and unlock this hidden milestone.');

        const iconBlob = extractBlobInfo(def.icon);
        const lockedBlob = extractBlobInfo(def.lockedIcon);
        const iconUrl =
          iconUrlOverride ??
          makeBlobProxyUrl(did, iconBlob.cid ?? lockedBlob.cid);

        this.db
          .prepare(
            `INSERT INTO achievement_definitions (
               uri, publisher_did, rkey, cid, game_uri, title, description, requirement,
               icon_url, icon_cid, icon_mime, icon_alt, locked_icon_cid, locked_icon_mime,
               tier, hidden, hidden_space, is_redacted_stub, trusted_issuers_json,
               counts_toward_completion, repeatable, available_from, available_until,
               retired, translations_json, steps_needed, group_name, list_order, badge_uri,
               created_at, raw_json, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
               hidden_space = excluded.hidden_space,
               is_redacted_stub = excluded.is_redacted_stub,
               trusted_issuers_json = excluded.trusted_issuers_json,
               counts_toward_completion = excluded.counts_toward_completion,
               repeatable = excluded.repeatable,
               available_from = excluded.available_from,
               available_until = excluded.available_until,
               retired = excluded.retired,
               translations_json = excluded.translations_json,
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
            storedTitle,
            storedDesc,
            def.requirement ?? null,
            iconUrl,
            iconBlob.cid ?? null,
            iconBlob.mimeType ?? null,
            def.iconAlt ?? null,
            lockedBlob.cid ?? null,
            lockedBlob.mimeType ?? null,
            def.tier ?? null,
            def.hidden ? 1 : 0,
            def.hiddenSpace ?? null,
            isRedactedStub ? 1 : 0,
            def.trustedIssuers ? JSON.stringify(def.trustedIssuers) : null,
            def.countsTowardCompletion === false ? 0 : 1,
            def.repeatable ? 1 : 0,
            def.availableFrom ?? null,
            def.availableUntil ?? null,
            def.retired ? 1 : 0,
            def.translations ? JSON.stringify(def.translations) : null,
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
        const hasComponents = Boolean(
          def.components &&
            typeof def.components === 'object' &&
            !Array.isArray(def.components) &&
            Object.keys(def.components).length > 0
        );
        const hasScoreConfig = Boolean(def.scoreFormat || hasComponents);
        if (!def.game || !def.name || !hasScoreConfig || !def.timeframes || !def.recordPolicy) {
          return { indexed: false, collection, error: 'Missing required leaderboard.definition fields' };
        }
        const compDefErr = validateComponentDefs(def.components, def.componentOrder);
        if (compDefErr) {
          return { indexed: false, collection, error: compDefErr };
        }
        const dimDefErr = validateDimensionDefs(def.dimensions, def.dimensionOrder);
        if (dimDefErr) {
          return { indexed: false, collection, error: dimDefErr };
        }
        const iconBlob = extractBlobInfo(def.icon);
        const iconUrl = iconUrlOverride ?? makeBlobProxyUrl(did, iconBlob.cid);
        const sortOrder = def.sortOrder ?? 'largerIsBetter';
        const rankingMode = def.rankingMode === 'latest' ? 'latest' : 'best';
        const scoreFormat = def.scoreFormat ?? { kind: 'numeric', decimalPlaces: 0 };

        this.db
          .prepare(
            `INSERT INTO leaderboard_definitions (
               uri, publisher_did, rkey, cid, game_uri, name, description,
               icon_url, icon_cid, icon_mime, icon_alt, sort_order, ranking_mode, score_format_json,
               components_json, default_component, dimensions_json, dimension_order_json,
               details_schema, ranked_versions_json, trusted_issuers_json, starts_at, ends_at,
               translations_json, timeframes_json, record_policy, score_min, score_max,
               list_order, created_at, raw_json, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
               ranking_mode = excluded.ranking_mode,
               score_format_json = excluded.score_format_json,
               components_json = excluded.components_json,
               default_component = excluded.default_component,
               dimensions_json = excluded.dimensions_json,
               dimension_order_json = excluded.dimension_order_json,
               details_schema = excluded.details_schema,
               ranked_versions_json = excluded.ranked_versions_json,
               trusted_issuers_json = excluded.trusted_issuers_json,
               starts_at = excluded.starts_at,
               ends_at = excluded.ends_at,
               translations_json = excluded.translations_json,
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
            sortOrder,
            rankingMode,
            JSON.stringify(scoreFormat),
            def.components ? JSON.stringify(def.components) : null,
            def.defaultComponent ?? null,
            def.dimensions ? JSON.stringify(def.dimensions) : null,
            def.dimensionOrder ? JSON.stringify(def.dimensionOrder) : null,
            def.detailsSchema ?? null,
            def.rankedVersions ? JSON.stringify(def.rankedVersions) : null,
            def.trustedIssuers ? JSON.stringify(def.trustedIssuers) : null,
            def.startsAt ?? null,
            def.endsAt ?? null,
            def.translations ? JSON.stringify(def.translations) : null,
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

      case NSIDS.ChallengeDefinition: {
        const def = record as ChallengeDefinitionRecord;
        if (!def.game || !def.title || !def.cadence) {
          return { indexed: false, collection, error: 'Missing required challenge.definition fields' };
        }
        const iconBlob = extractBlobInfo(def.icon);
        const iconUrl = iconUrlOverride ?? makeBlobProxyUrl(did, iconBlob.cid);

        this.db
          .prepare(
            `INSERT INTO challenge_definitions (
               uri, publisher_did, rkey, cid, game_uri, title, description,
               icon_url, icon_cid, icon_mime, icon_alt, cadence, seed, target_steps,
               leaderboard_uri, reward_achievement_uri, dimensions_json, trusted_issuers_json,
               starts_at, ends_at, translations_json, created_at, raw_json, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               cid = excluded.cid,
               game_uri = excluded.game_uri,
               title = excluded.title,
               description = excluded.description,
               icon_url = COALESCE(excluded.icon_url, challenge_definitions.icon_url),
               icon_cid = excluded.icon_cid,
               icon_mime = excluded.icon_mime,
               icon_alt = excluded.icon_alt,
               cadence = excluded.cadence,
               seed = excluded.seed,
               target_steps = excluded.target_steps,
               leaderboard_uri = excluded.leaderboard_uri,
               reward_achievement_uri = excluded.reward_achievement_uri,
               dimensions_json = excluded.dimensions_json,
               trusted_issuers_json = excluded.trusted_issuers_json,
               starts_at = excluded.starts_at,
               ends_at = excluded.ends_at,
               translations_json = excluded.translations_json,
               raw_json = excluded.raw_json`
          )
          .run(
            uri,
            did,
            rkey,
            cid ?? null,
            def.game,
            def.title,
            def.description ?? null,
            iconUrl,
            iconBlob.cid ?? null,
            iconBlob.mimeType ?? null,
            def.iconAlt ?? null,
            def.cadence,
            def.seed ?? null,
            typeof def.targetSteps === 'number' ? Math.trunc(def.targetSteps) : null,
            def.leaderboard ?? null,
            def.rewardAchievement ?? null,
            def.dimensions ? JSON.stringify(def.dimensions) : null,
            def.trustedIssuers ? JSON.stringify(def.trustedIssuers) : null,
            def.startsAt ?? null,
            def.endsAt ?? null,
            def.translations ? JSON.stringify(def.translations) : null,
            def.createdAt ?? now,
            rawJson,
            isDemo ? 1 : 0
          );

        return { indexed: true, collection };
      }

      case NSIDS.AchievementUnlock: {
        return this.indexUnlockRecord({ uri, cid, did, rkey, record: record as AchievementUnlockRecord, isDemo, now });
      }

      case NSIDS.AchievementProgress: {
        const prog = record as AchievementProgressRecord;
        if (!prog.achievement || typeof prog.currentSteps !== 'number') {
          return { indexed: false, collection, error: 'Invalid achievement.progress record' };
        }
        const achParsed = parseAtUri(prog.achievement);
        const defRow = this.db
          .prepare('SELECT game_uri, steps_needed, trusted_issuers_json FROM achievement_definitions WHERE uri = ?')
          .get(prog.achievement) as
          | { game_uri?: string; steps_needed?: number; trusted_issuers_json?: string | null }
          | undefined;

        const trustedIssuers: string[] = defRow?.trusted_issuers_json
          ? JSON.parse(defRow.trusted_issuers_json)
          : [];

        let verified = 0;
        let attestationCid: string | null = null;

        if (Array.isArray(prog.signatures) && prog.signatures.length > 0 && achParsed) {
          const revocations = this.getPublisherRevocations([achParsed.did, ...trustedIssuers]);
          const v = await verifyRecordAttestation({
            record: prog,
            playerDid: did,
            recordUri: uri,
            recordCid: cid,
            expectedIssuerDid: achParsed.did,
            trustedIssuerDids: trustedIssuers,
            revocations,
            resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
          });
          if (v.verified) {
            verified = 1;
            attestationCid = v.attestationCid;
          }
        }

        this.db
          .prepare(
            `INSERT INTO achievement_progress (
               uri, player_did, rkey, achievement_uri, definition_cid, game_uri,
               current_steps, steps_needed, updated_at, verified, attestation_cid,
               raw_json, indexed_at, is_demo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(uri) DO UPDATE SET
               definition_cid = excluded.definition_cid,
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
            prog.definitionCid ?? null,
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
        return this.indexScoreRecord({ uri, cid, did, rkey, record: record as LeaderboardScoreRecord, isDemo, now });
      }

      case NSIDS.MatchResult: {
        return this.indexMatchRecord({ uri, cid, did, rkey, record: record as MatchResultRecord, isDemo, now });
      }

      case NSIDS.Revocation: {
        const rev = record as RevocationRecord;
        if (!rev.scope || !rev.player || !rev.subject || !rev.reason) {
          return { indexed: false, collection, error: 'Missing required revocation fields' };
        }
        const subjectParsed = parseAtUri(rev.subject);
        if (!subjectParsed) {
          return { indexed: false, collection, error: 'Invalid revocation subject URI' };
        }
        // Authority check: publisher DID must either own subject URI OR be listed in subject's trustedIssuers!
        let isAuthorizedIssuer = subjectParsed.did === did;
        if (!isAuthorizedIssuer) {
          const lbTrusted = this.db
            .prepare('SELECT trusted_issuers_json FROM leaderboard_definitions WHERE uri = ?')
            .get(rev.subject) as { trusted_issuers_json?: string | null } | undefined;
          const achTrusted = this.db
            .prepare('SELECT trusted_issuers_json FROM achievement_definitions WHERE uri = ?')
            .get(rev.subject) as { trusted_issuers_json?: string | null } | undefined;
          const chTrusted = this.db
            .prepare('SELECT trusted_issuers_json FROM challenge_definitions WHERE uri = ?')
            .get(rev.subject) as { trusted_issuers_json?: string | null } | undefined;
          const rawList =
            lbTrusted?.trusted_issuers_json ??
            achTrusted?.trusted_issuers_json ??
            chTrusted?.trusted_issuers_json;
          if (rawList) {
            const parsedList = JSON.parse(rawList) as string[];
            isAuthorizedIssuer = parsedList.includes(did);
          }
        }
        if (!isAuthorizedIssuer) {
          return { indexed: false, collection, error: 'Revocation publisher DID is not authorized for subject URI' };
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

        await this.revalidatePublisherRecords(did, subjectParsed.did);
        return { indexed: true, collection };
      }

      default:
        return { indexed: false, collection };
    }
  }

  private async indexUnlockRecord({
    uri,
    cid,
    did,
    rkey,
    record,
    isDemo,
    now,
  }: {
    uri: string;
    cid?: string;
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
    const defRow = this.db
      .prepare('SELECT game_uri, trusted_issuers_json FROM achievement_definitions WHERE uri = ?')
      .get(record.achievement) as { game_uri?: string; trusted_issuers_json?: string | null } | undefined;

    const trustedIssuers: string[] = defRow?.trusted_issuers_json
      ? JSON.parse(defRow.trusted_issuers_json)
      : [];

    const revocations = this.getPublisherRevocations([publisherDid ?? '', ...trustedIssuers]);
    const activeLabels = this.getActiveModerationLabels([uri, did]);
    const activeLabelVals = getRecordLabelValues({
      recordUri: uri,
      recordCid: cid,
      playerDid: did,
      activeLabels,
    });

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowCommunityLabelVerification: true,
      revocations,
      activeLabels,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const isVerified = verification.verified ? 1 : 0;
    const isLabelInvalidated = !verification.verified && verification.error === 'label_invalidated' ? 1 : 0;
    const isRevoked =
      !verification.verified && (verification.error === 'revoked' || verification.error === 'label_invalidated')
        ? 1
        : 0;
    const revocationReason = !verification.verified
      ? verification.revocation?.reason ?? (isLabelInvalidated ? verification.labels?.[0]?.val ?? 'labeled' : null)
      : null;
    const verificationError = !verification.verified ? verification.error : null;
    const verificationMessage = !verification.verified ? verification.message : null;
    const issuerDid = verification.issuerDid ?? publisherDid ?? null;
    const keyId = verification.verified ? verification.keyId : record.signatures?.[0]?.key ?? null;
    const attestationCid = verification.attestationCid ?? record.signatures?.[0]?.cid ?? null;

    const mediaBlob = extractBlobInfo(record.media);
    const mediaUrl = makeBlobProxyUrl(did, mediaBlob.cid);

    this.db
      .prepare(
        `INSERT INTO achievement_unlocks (
           uri, player_did, rkey, achievement_uri, game_uri, unlocked_at, steps_completed,
           participants_json, run_id, details_json, media_url, media_cid, media_mime, media_alt, note,
           verified, verification_error, verification_message, issuer_did, key_id,
           attestation_cid, revoked, revocation_reason, label_invalidated, active_labels_json,
           raw_json, indexed_at, is_demo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           achievement_uri = excluded.achievement_uri,
           game_uri = COALESCE(excluded.game_uri, achievement_unlocks.game_uri),
           unlocked_at = excluded.unlocked_at,
           steps_completed = excluded.steps_completed,
           participants_json = excluded.participants_json,
           run_id = excluded.run_id,
           details_json = excluded.details_json,
           media_url = excluded.media_url,
           media_cid = excluded.media_cid,
           media_mime = excluded.media_mime,
           media_alt = excluded.media_alt,
           note = excluded.note,
           verified = excluded.verified,
           verification_error = excluded.verification_error,
           verification_message = excluded.verification_message,
           issuer_did = excluded.issuer_did,
           key_id = excluded.key_id,
           attestation_cid = excluded.attestation_cid,
           revoked = excluded.revoked,
           revocation_reason = excluded.revocation_reason,
           label_invalidated = excluded.label_invalidated,
           active_labels_json = excluded.active_labels_json,
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
        record.participants ? JSON.stringify(record.participants) : null,
        record.runId ?? null,
        record.details ? JSON.stringify(record.details) : null,
        mediaUrl,
        mediaBlob.cid ?? null,
        mediaBlob.mimeType ?? null,
        record.mediaAlt ?? null,
        record.note ?? null,
        isVerified,
        verificationError,
        verificationMessage,
        issuerDid,
        keyId,
        attestationCid,
        isRevoked,
        revocationReason,
        isLabelInvalidated,
        activeLabelVals.length > 0 ? JSON.stringify(activeLabelVals) : null,
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
    cid,
    did,
    rkey,
    record,
    isDemo,
    now,
  }: {
    uri: string;
    cid?: string;
    did: string;
    rkey: string;
    record: LeaderboardScoreRecord;
    isDemo: boolean;
    now: string;
  }): Promise<{ indexed: boolean; collection: string; verified: boolean; revoked: boolean; error?: string }> {
    const hasNumericScore = typeof record.score === 'number' && Number.isInteger(record.score);
    const hasComponents = Boolean(
      record.components &&
        typeof record.components === 'object' &&
        !Array.isArray(record.components) &&
        Object.keys(record.components).length > 0
    );

    if (!record.leaderboard || (!hasNumericScore && !hasComponents) || !record.recordedAt) {
      return {
        indexed: false,
        collection: NSIDS.LeaderboardScore,
        verified: false,
        revoked: false,
        error: 'Missing leaderboard, integer score (or components), or recordedAt',
      };
    }

    const lbParsed = parseAtUri(record.leaderboard);
    const publisherDid = lbParsed?.did;

    const defRow = this.db
      .prepare('SELECT * FROM leaderboard_definitions WHERE uri = ?')
      .get(record.leaderboard) as Record<string, any> | undefined;

    const parsedDef: LeaderboardDefinitionRecord | undefined = defRow?.raw_json
      ? (JSON.parse(String(defRow.raw_json)) as LeaderboardDefinitionRecord)
      : undefined;

    const trustedIssuers: string[] = defRow?.trusted_issuers_json
      ? JSON.parse(String(defRow.trusted_issuers_json))
      : [];

    const revocations = this.getPublisherRevocations([publisherDid ?? '', ...trustedIssuers]);
    const activeLabels = this.getActiveModerationLabels([uri, did]);
    const activeLabelVals = getRecordLabelValues({
      recordUri: uri,
      recordCid: cid,
      playerDid: did,
      activeLabels,
    });

    const metric = parsedDef ? getScoreSortMetric(record, parsedDef) : null;
    const effectiveScore = hasNumericScore ? record.score! : metric?.sortableValue ?? 0;

    const componentValidationError = parsedDef ? validateScoreComponents(record.components, parsedDef) : null;
    const dimensionValidationError = parsedDef ? validateScoreDimensions(record.dimensions, parsedDef) : null;
    const inWindow = parsedDef ? isWithinLeaderboardWindow(record.recordedAt, parsedDef) : true;
    const windowValidationError = !inWindow
      ? `Score recordedAt "${record.recordedAt}" falls outside leaderboard window [${parsedDef?.startsAt ?? '-∞'}, ${parsedDef?.endsAt ?? '+∞'}].`
      : null;

    const outOfHeadlineBounds =
      hasNumericScore &&
      ((defRow?.score_min !== null && defRow?.score_min !== undefined && record.score! < Number(defRow.score_min)) ||
        (defRow?.score_max !== null && defRow?.score_max !== undefined && record.score! > Number(defRow.score_max)));

    const outOfBounds =
      outOfHeadlineBounds ||
      Boolean(componentValidationError) ||
      Boolean(dimensionValidationError) ||
      Boolean(windowValidationError);

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowCommunityLabelVerification: true,
      revocations,
      activeLabels,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const isVerified = verification.verified && !outOfBounds ? 1 : 0;
    const isLabelInvalidated = !verification.verified && verification.error === 'label_invalidated' ? 1 : 0;
    const isRevoked =
      !verification.verified && (verification.error === 'revoked' || verification.error === 'label_invalidated')
        ? 1
        : 0;
    const revocationReason = !verification.verified
      ? verification.revocation?.reason ?? (isLabelInvalidated ? verification.labels?.[0]?.val ?? 'labeled' : null)
      : null;
    const verificationError = outOfBounds
      ? 'out_of_bounds'
      : !verification.verified
        ? verification.error
        : null;
    const verificationMessage = outOfBounds
      ? componentValidationError ??
        dimensionValidationError ??
        windowValidationError ??
        `Score ${effectiveScore} falls outside leaderboard bounds [${defRow?.score_min ?? '-∞'}, ${defRow?.score_max ?? '+∞'}].`
      : !verification.verified
        ? verification.message
        : null;
    const issuerDid = verification.issuerDid ?? publisherDid ?? null;
    const keyId = verification.verified ? verification.keyId : record.signatures?.[0]?.key ?? null;
    const attestationCid = verification.attestationCid ?? record.signatures?.[0]?.cid ?? null;

    const replayBlob = extractBlobInfo(record.replay);

    this.db
      .prepare(
        `INSERT INTO leaderboard_scores (
           uri, player_did, rkey, leaderboard_uri, game_uri, score, display_score,
           components_json, dimensions_json, seed, participants_json, run_id,
           details_json, version, replay_cid, replay_mime, tag,
           recorded_at, verified, verification_error, verification_message, issuer_did,
           key_id, attestation_cid, revoked, revocation_reason, label_invalidated,
           active_labels_json, raw_json, indexed_at, is_demo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           leaderboard_uri = excluded.leaderboard_uri,
           game_uri = COALESCE(excluded.game_uri, leaderboard_scores.game_uri),
           score = excluded.score,
           display_score = excluded.display_score,
           components_json = excluded.components_json,
           dimensions_json = excluded.dimensions_json,
           seed = excluded.seed,
           participants_json = excluded.participants_json,
           run_id = excluded.run_id,
           details_json = excluded.details_json,
           version = excluded.version,
           replay_cid = excluded.replay_cid,
           replay_mime = excluded.replay_mime,
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
           label_invalidated = excluded.label_invalidated,
           active_labels_json = excluded.active_labels_json,
           raw_json = excluded.raw_json,
           indexed_at = excluded.indexed_at`
      )
      .run(
        uri,
        did,
        rkey,
        record.leaderboard,
        record.game ?? (defRow?.game_uri ? String(defRow.game_uri) : null),
        effectiveScore,
        record.displayScore ?? null,
        record.components ? JSON.stringify(record.components) : null,
        record.dimensions ? JSON.stringify(record.dimensions) : null,
        record.seed ?? null,
        record.participants ? JSON.stringify(record.participants) : null,
        record.runId ?? null,
        record.details ? JSON.stringify(record.details) : null,
        record.version ?? null,
        replayBlob.cid ?? null,
        replayBlob.mimeType ?? null,
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
        isLabelInvalidated,
        activeLabelVals.length > 0 ? JSON.stringify(activeLabelVals) : null,
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

  private async indexMatchRecord({
    uri,
    cid,
    did,
    rkey,
    record,
    isDemo,
    now,
  }: {
    uri: string;
    cid?: string;
    did: string;
    rkey: string;
    record: MatchResultRecord;
    isDemo: boolean;
    now: string;
  }): Promise<{ indexed: boolean; collection: string; verified: boolean; revoked: boolean; error?: string }> {
    if (
      !record.game ||
      !Array.isArray(record.participants) ||
      record.participants.length < 2 ||
      !record.playedAt
    ) {
      return {
        indexed: false,
        collection: NSIDS.MatchResult,
        verified: false,
        revoked: false,
        error: 'Missing game, >=2 participants, or playedAt on match.result',
      };
    }

    const gameParsed = parseAtUri(record.game);
    const lbParsed = record.leaderboard ? parseAtUri(record.leaderboard) : null;
    const chParsed = record.challenge ? parseAtUri(record.challenge) : null;
    const publisherDid = lbParsed?.did ?? chParsed?.did ?? gameParsed?.did;

    const lbTrustedRow = record.leaderboard
      ? (this.db
          .prepare('SELECT trusted_issuers_json FROM leaderboard_definitions WHERE uri = ?')
          .get(record.leaderboard) as { trusted_issuers_json?: string | null } | undefined)
      : undefined;
    const chTrustedRow = record.challenge
      ? (this.db
          .prepare('SELECT trusted_issuers_json FROM challenge_definitions WHERE uri = ?')
          .get(record.challenge) as { trusted_issuers_json?: string | null } | undefined)
      : undefined;

    const trustedIssuers = [
      ...(lbTrustedRow?.trusted_issuers_json ? (JSON.parse(lbTrustedRow.trusted_issuers_json) as string[]) : []),
      ...(chTrustedRow?.trusted_issuers_json ? (JSON.parse(chTrustedRow.trusted_issuers_json) as string[]) : []),
    ];

    const participantDids = record.participants
      .map((p) => p?.did)
      .filter((d): d is string => typeof d === 'string' && d.startsWith('did:'));

    for (const pDid of participantDids) {
      if (!this.identity.getCachedActor(pDid)) {
        this.identity.upsertActor({ did: pDid, isDemo });
      }
    }

    const revocations = this.getPublisherRevocations([
      publisherDid ?? '',
      gameParsed?.did ?? '',
      ...trustedIssuers,
    ]);
    const activeLabels = this.getActiveModerationLabels([uri, did, ...participantDids]);
    const activeLabelVals = getRecordLabelValues({
      recordUri: uri,
      recordCid: cid,
      playerDid: did,
      activeLabels,
    });

    const verification = await verifyMatchResult({
      record,
      repositoryDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowParticipantCoSigning: true,
      allowCommunityLabelVerification: true,
      revocations,
      activeLabels,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const isVerified = verification.verified ? 1 : 0;
    const verificationMethod = verification.verified ? verification.verificationMethod ?? 'attestation' : null;
    const coSigners = verification.verified && verification.coSigners ? verification.coSigners : null;
    const isLabelInvalidated = !verification.verified && verification.error === 'label_invalidated' ? 1 : 0;
    const isRevoked =
      !verification.verified && (verification.error === 'revoked' || verification.error === 'label_invalidated')
        ? 1
        : 0;
    const revocationReason = !verification.verified
      ? verification.revocation?.reason ?? (isLabelInvalidated ? verification.labels?.[0]?.val ?? 'labeled' : null)
      : null;
    const verificationError = !verification.verified ? verification.error : null;
    const verificationMessage = !verification.verified ? verification.message : null;
    const issuerDid = verification.issuerDid ?? publisherDid ?? null;
    const keyId = verification.verified ? verification.keyId : record.signatures?.[0]?.key ?? null;
    const attestationCid = verification.attestationCid ?? record.signatures?.[0]?.cid ?? null;
    const replayBlob = extractBlobInfo(record.replay);

    this.db
      .prepare(
        `INSERT INTO match_results (
           uri, repository_did, rkey, cid, game_uri, match_id, mode, leaderboard_uri,
           challenge_uri, dimensions_json, participants_json, details_json, version,
           replay_cid, replay_mime, played_at, verified, verification_method,
           verification_error, verification_message, issuer_did, cosigners_json,
           key_id, attestation_cid, revoked, revocation_reason, label_invalidated,
           active_labels_json, raw_json, indexed_at, is_demo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           cid = excluded.cid,
           game_uri = excluded.game_uri,
           match_id = excluded.match_id,
           mode = excluded.mode,
           leaderboard_uri = excluded.leaderboard_uri,
           challenge_uri = excluded.challenge_uri,
           dimensions_json = excluded.dimensions_json,
           participants_json = excluded.participants_json,
           details_json = excluded.details_json,
           version = excluded.version,
           replay_cid = excluded.replay_cid,
           replay_mime = excluded.replay_mime,
           played_at = excluded.played_at,
           verified = excluded.verified,
           verification_method = excluded.verification_method,
           verification_error = excluded.verification_error,
           verification_message = excluded.verification_message,
           issuer_did = excluded.issuer_did,
           cosigners_json = excluded.cosigners_json,
           key_id = excluded.key_id,
           attestation_cid = excluded.attestation_cid,
           revoked = excluded.revoked,
           revocation_reason = excluded.revocation_reason,
           label_invalidated = excluded.label_invalidated,
           active_labels_json = excluded.active_labels_json,
           raw_json = excluded.raw_json,
           indexed_at = excluded.indexed_at`
      )
      .run(
        uri,
        did,
        rkey,
        cid ?? null,
        record.game,
        record.matchId ?? null,
        record.mode ?? null,
        record.leaderboard ?? null,
        record.challenge ?? null,
        record.dimensions ? JSON.stringify(record.dimensions) : null,
        JSON.stringify(record.participants),
        record.details ? JSON.stringify(record.details) : null,
        record.version ?? null,
        replayBlob.cid ?? null,
        replayBlob.mimeType ?? null,
        record.playedAt,
        isVerified,
        verificationMethod,
        verificationError,
        verificationMessage,
        issuerDid,
        coSigners ? JSON.stringify(coSigners) : null,
        keyId,
        attestationCid,
        isRevoked,
        revocationReason,
        isLabelInvalidated,
        activeLabelVals.length > 0 ? JSON.stringify(activeLabelVals) : null,
        JSON.stringify(record),
        now,
        isDemo ? 1 : 0
      );

    return {
      indexed: true,
      collection: NSIDS.MatchResult,
      verified: isVerified === 1,
      revoked: isRevoked === 1,
      error: verificationError ?? undefined,
    };
  }

  /**
   * Re-evaluate stored unlocks & scores whenever a revocation is added, updated, or deleted.
   */
  async revalidatePublisherRecords(publisherDid: string, subjectOwnerDid?: string): Promise<void> {
    const dids = [...new Set([publisherDid, ...(subjectOwnerDid ? [subjectOwnerDid] : [])])];
    const placeholders = dids.map(() => '?').join(', ');
    const likePatterns = dids.map((d) => `at://${d}/%`);
    const likeClause = likePatterns.map(() => 'achievement_uri LIKE ?').join(' OR ');

    const unlocks = this.db
      .prepare(
        `SELECT uri, player_did, rkey, raw_json, is_demo
         FROM achievement_unlocks
         WHERE issuer_did IN (${placeholders}) OR ${likeClause}`
      )
      .all(...dids, ...likePatterns) as Array<{
      uri: string;
      player_did: string;
      rkey: string;
      raw_json: string;
      is_demo: number;
    }>;

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

    const lbLikeClause = likePatterns.map(() => 'leaderboard_uri LIKE ?').join(' OR ');
    const scores = this.db
      .prepare(
        `SELECT uri, player_did, rkey, raw_json, is_demo
         FROM leaderboard_scores
         WHERE issuer_did IN (${placeholders}) OR ${lbLikeClause}`
      )
      .all(...dids, ...likePatterns) as Array<{
      uri: string;
      player_did: string;
      rkey: string;
      raw_json: string;
      is_demo: number;
    }>;

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

    const gameLikeClause = likePatterns.map(() => 'game_uri LIKE ?').join(' OR ');
    const matches = this.db
      .prepare(
        `SELECT uri, repository_did, rkey, cid, raw_json, is_demo
         FROM match_results
         WHERE issuer_did IN (${placeholders}) OR ${gameLikeClause}`
      )
      .all(...dids, ...likePatterns) as Array<{
      uri: string;
      repository_did: string;
      rkey: string;
      cid?: string | null;
      raw_json: string;
      is_demo: number;
    }>;

    for (const m of matches) {
      await this.indexMatchRecord({
        uri: m.uri,
        cid: m.cid ?? undefined,
        did: m.repository_did,
        rkey: m.rkey,
        record: JSON.parse(m.raw_json) as MatchResultRecord,
        isDemo: m.is_demo === 1,
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
      case NSIDS.ChallengeDefinition:
        this.db.prepare('DELETE FROM challenge_definitions WHERE uri = ?').run(uri);
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
      case NSIDS.MatchResult:
        this.db.prepare('DELETE FROM match_results WHERE uri = ?').run(uri);
        return true;
      case NSIDS.Revocation: {
        const prev = this.db
          .prepare('SELECT subject_uri FROM revocations WHERE uri = ?')
          .get(uri) as { subject_uri?: string } | undefined;
        const subjectOwner = prev?.subject_uri ? parseAtUri(prev.subject_uri)?.did : undefined;
        this.db.prepare('DELETE FROM revocations WHERE uri = ?').run(uri);
        await this.revalidatePublisherRecords(did, subjectOwner);
        return true;
      }
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
