import { NSIDS } from '../constants.js';
import { verifyRecordAttestation } from '../attestation.js';
import { getRecordLabelValues, resolveActiveLabels } from '../labels.js';
import {
  formatScore,
  getOrderedComponentIds,
  getScoreSortMetric,
  getTimeframeStartMs,
  isBetterScore,
  isVersionLegal,
  isWithinLeaderboardWindow,
  matchesDimensionFilter,
  parseDimensionsFilter,
  validateComponentDefs,
  validateDimensionDefs,
  validateScoreComponents,
  validateScoreDimensions,
} from '../leaderboards.js';
import { verifyMatchResult } from '../matches.js';
import {
  calculateGameCompletion,
  isCompletionOptional,
  isWithinTimelock,
  resolveTranslation,
  sortAchievementDefinitions,
  summarizeActorProfile,
  validateTimelockRanges,
  type DefinitionEntry,
} from '../profile.js';
import type {
  AchievementDefinitionRecord,
  AchievementProgressRecord,
  AchievementUnlockRecord,
  ActorProfileSummary,
  AtprotoLabel,
  ChallengeDefinitionRecord,
  LeaderboardDefinitionRecord,
  LeaderboardScoreRecord,
  LeaderboardSortOrder,
  MatchResultRecord,
  Participant,
  RankingMode,
  RevocationRecord,
  RevocationWithOrigin,
  ScoreComponentValMap,
  ScoreFormat,
  StringMap,
  Timeframe,
} from '../types.js';
import { AppViewIdentityResolver, type AppViewIdentityOptions } from './identity.js';
import { MemoryAppViewStore } from './store.js';
import {
  DEFAULT_CATALOG_COLLECTIONS,
  DEFAULT_LIBRARY_COLLECTIONS,
  type ActorGameLibraryItem,
  type ActorGameLibraryResponse,
  type ActorLibraryPersonalBest,
  type AppViewStorageAdapter,
  type GameHubView,
  type LeaderboardGetScoresResponse,
  type LeaderboardScoreViewEntry,
  type LibraryItemSource,
  type LibraryShelfStatus,
  type MatchHistoryEntry,
  type MatchHistoryResponse,
  type StoredVerifiedRecord,
  type ViewerAchievementCard,
} from './types.js';

export interface ParsedAtUri {
  uri: string;
  did: string;
  collection: string;
  rkey: string;
}

export function parseAtUri(uri: string): ParsedAtUri | null {
  if (typeof uri !== 'string' || !uri.startsWith('at://')) return null;
  const parts = uri.slice('at://'.length).split('/');
  if (parts.length < 3) return null;
  const [did, collection, ...rest] = parts;
  const rkey = rest.join('/');
  if (!did.startsWith('did:') || !collection || !rkey) return null;
  return { uri, did, collection, rkey };
}

function extractBlobInfo(blob: unknown): { cid?: string; mimeType?: string } {
  if (!blob || typeof blob !== 'object') return {};
  const b = blob as Record<string, any>;
  const link =
    typeof b.ref?.$link === 'string'
      ? b.ref.$link
      : typeof b.ref?.toString === 'function' && b.ref.toString() !== '[object Object]'
        ? b.ref.toString()
        : typeof b.cid === 'string'
          ? b.cid
          : undefined;
  const mimeType = typeof b.mimeType === 'string' ? b.mimeType : undefined;
  return { cid: link, mimeType };
}

function normalizeShelfStatus(raw: unknown): LibraryShelfStatus {
  if (typeof raw !== 'string' || !raw.trim()) return 'owned';
  const clean = raw.trim().toLowerCase();
  switch (clean) {
    case 'playing':
    case 'currently-playing':
    case 'in-progress':
      return 'playing';
    case 'completed':
    case 'beaten':
    case 'finished':
      return 'completed';
    case 'backlog':
    case 'plan-to-play':
    case 'queued':
      return 'backlog';
    case 'wishlist':
    case 'want-to-play':
      return 'wishlist';
    case 'dropped':
    case 'abandoned':
      return 'dropped';
    case 'shelved':
    case 'on-hold':
    case 'paused':
      return 'shelved';
    default:
      return raw.trim();
  }
}

export interface OpenGamingAppViewOptions {
  store?: AppViewStorageAdapter;
  identity?: AppViewIdentityResolver;
  identityOptions?: AppViewIdentityOptions;
  catalogCollections?: readonly string[];
  libraryCollections?: readonly string[];
  trustedLabelerDids?: string[];
  allowAnyValidIssuer?: boolean;
  allowCommunityLabelVerification?: boolean;
  allowParticipantCoSigning?: boolean;
  blobProxyBasePath?: string;
  defaultPdsUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Core Open Gaming AppView indexer, verifier, and query engine.
 * Indexes `games.opengaming.*` achievements, leaderboards, challenges, matches, and revocations
 * alongside ATmosphere game catalog (`games.atmosphere.define` / `games.gamesgamesgamesgames.game`)
 * and player game library/shelf collections.
 */
export class OpenGamingAppViewEngine {
  readonly store: AppViewStorageAdapter;
  readonly identity: AppViewIdentityResolver;
  private catalogCollections: Set<string>;
  private libraryCollections: Set<string>;
  private trustedLabelerDids?: string[];
  private allowAnyValidIssuer: boolean;
  private allowCommunityLabelVerification: boolean;
  private allowParticipantCoSigning: boolean;
  private blobProxyBasePath: string;
  private defaultPdsUrl: string;
  private fetchImpl: typeof fetch;

  constructor(options?: OpenGamingAppViewOptions) {
    this.store = options?.store ?? new MemoryAppViewStore();
    this.identity =
      options?.identity ??
      new AppViewIdentityResolver(this.store, {
        ...options?.identityOptions,
        fetchImpl: options?.fetchImpl ?? options?.identityOptions?.fetchImpl,
      });
    this.catalogCollections = new Set(options?.catalogCollections ?? DEFAULT_CATALOG_COLLECTIONS);
    this.libraryCollections = new Set(options?.libraryCollections ?? DEFAULT_LIBRARY_COLLECTIONS);
    this.trustedLabelerDids = options?.trustedLabelerDids;
    this.allowAnyValidIssuer = options?.allowAnyValidIssuer ?? false;
    this.allowCommunityLabelVerification = options?.allowCommunityLabelVerification ?? true;
    this.allowParticipantCoSigning = options?.allowParticipantCoSigning ?? true;
    this.blobProxyBasePath = (options?.blobProxyBasePath ?? '/api/blob').replace(/\/+$/, '');
    this.defaultPdsUrl = (options?.defaultPdsUrl ?? 'https://bsky.social').replace(/\/+$/, '');
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  }

  getWatchedCollections(): string[] {
    return [
      ...this.catalogCollections,
      NSIDS.AchievementDefinition,
      NSIDS.LeaderboardDefinition,
      NSIDS.ChallengeDefinition,
      NSIDS.Revocation,
      ...this.libraryCollections,
      NSIDS.AchievementUnlock,
      NSIDS.AchievementProgress,
      NSIDS.LeaderboardScore,
      NSIDS.MatchResult,
    ];
  }

  makeBlobProxyUrl(did: string, cid?: string): string | undefined {
    if (!cid) return undefined;
    return `${this.blobProxyBasePath}?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
  }

  private async getRevocationsForPublishers(publisherDids: string[]): Promise<RevocationWithOrigin[]> {
    const clean = [...new Set(publisherDids.filter(Boolean))];
    if (clean.length === 0) return [];
    const stored = await this.store.listRevocations(clean);
    return stored.map((r) => ({
      uri: r.uri,
      publisherDid: r.publisherDid,
      value: r.record,
    }));
  }

  private async getActiveLabels(targetUris?: string[]): Promise<AtprotoLabel[]> {
    const events = await this.store.listLabelEvents(targetUris);
    return resolveActiveLabels(events);
  }

  /**
   * Ingest an ATProto `com.atproto.label.defs#label` moderation or replay-verification event,
   * then reactively re-evaluate all affected unlocks, scores, and matches.
   */
  async ingestLabel(label: AtprotoLabel): Promise<void> {
    await this.store.appendLabelEvent(label);
    await this.revalidateByLabelTarget(label.uri);
  }

  private async revalidateByLabelTarget(targetUriOrDid: string): Promise<void> {
    const isDid = targetUriOrDid.startsWith('did:');
    const unlocks = isDid
      ? await this.store.listUnlocks({ playerDid: targetUriOrDid })
      : [await this.store.getUnlock(targetUriOrDid)].filter(Boolean);

    for (const u of unlocks) {
      if (!u) continue;
      await this.indexUnlockInternal(u.uri, u.cid, u.repositoryDid, u.rkey, u.record);
    }

    const scores = isDid
      ? await this.store.listScores({ playerDid: targetUriOrDid })
      : [await this.store.getScore(targetUriOrDid)].filter(Boolean);

    for (const s of scores) {
      if (!s) continue;
      await this.indexScoreInternal(s.uri, s.cid, s.repositoryDid, s.rkey, s.record);
    }

    const matches = isDid
      ? await this.store.listMatches({ actorDid: targetUriOrDid })
      : [await this.store.getMatch(targetUriOrDid)].filter(Boolean);

    for (const m of matches) {
      if (!m) continue;
      await this.indexMatchInternal(m.uri, m.cid, m.repositoryDid, m.rkey, m.record);
    }
  }

  private async revalidatePublisherRecords(publisherDids: string[]): Promise<void> {
    const dids = [...new Set(publisherDids.filter(Boolean))];
    if (dids.length === 0) return;

    const unlocks = await this.store.listUnlocks({ publisherDids: dids });
    for (const u of unlocks) {
      await this.indexUnlockInternal(u.uri, u.cid, u.repositoryDid, u.rkey, u.record);
    }

    const scores = await this.store.listScores({ publisherDids: dids });
    for (const s of scores) {
      await this.indexScoreInternal(s.uri, s.cid, s.repositoryDid, s.rkey, s.record);
    }

    const matches = await this.store.listMatches({ publisherDids: dids });
    for (const m of matches) {
      await this.indexMatchInternal(m.uri, m.cid, m.repositoryDid, m.rkey, m.record);
    }
  }

  /**
   * Index any watched AT Protocol record (`games.opengaming.*`, game catalog definition, or player library item).
   */
  async indexRecord({
    uri,
    cid,
    record,
    iconUrlOverride,
  }: {
    uri: string;
    cid?: string;
    record: Record<string, any>;
    iconUrlOverride?: string;
  }): Promise<{
    indexed: boolean;
    collection?: string;
    verified?: boolean;
    revoked?: boolean;
    error?: string;
  }> {
    const parsed = parseAtUri(uri);
    if (!parsed) {
      return { indexed: false, error: `Invalid AT-URI: ${uri}` };
    }
    const { did, collection, rkey } = parsed;
    const now = new Date().toISOString();

    const existingActor = await this.store.getActor(did);
    if (!existingActor) {
      await this.store.upsertActor({ did, updatedAt: now });
    }

    if (this.catalogCollections.has(collection)) {
      const iconBlob = extractBlobInfo(record.icon ?? record.cover);
      const iconUrl = iconUrlOverride ?? this.makeBlobProxyUrl(did, iconBlob.cid);
      const developerName =
        typeof record.developer?.name === 'string'
          ? record.developer.name
          : typeof record.publisher === 'string'
            ? record.publisher
            : undefined;
      const developerDid =
        typeof record.developer?.did === 'string' ? record.developer.did : did;

      await this.store.upsertGame({
        uri,
        publisherDid: did,
        rkey,
        cid,
        name: String(record.name ?? record.title ?? rkey),
        tagline: typeof record.tagline === 'string' ? record.tagline : undefined,
        description: typeof record.description === 'string' ? record.description : undefined,
        url: typeof record.url === 'string' ? record.url : undefined,
        category: typeof record.category === 'string' ? record.category : undefined,
        status: typeof record.status === 'string' ? record.status : 'live',
        iconCid: iconBlob.cid,
        iconMime: iconBlob.mimeType,
        iconUrl,
        developerName,
        developerDid,
        rawRecord: record,
        indexedAt: now,
      });
      return { indexed: true, collection };
    }

    if (this.libraryCollections.has(collection)) {
      const gameUri =
        typeof record.game === 'string'
          ? record.game
          : typeof record.subject === 'string'
            ? record.subject
            : typeof record.gameUri === 'string'
              ? record.gameUri
              : undefined;
      if (!gameUri || !gameUri.startsWith('at://')) {
        return { indexed: false, collection, error: 'Library record missing valid `game` / `subject` AT-URI.' };
      }

      const playtimeMs =
        typeof record.playtimeMs === 'number'
          ? Math.max(0, Math.trunc(record.playtimeMs))
          : typeof record.playtimeMinutes === 'number'
            ? Math.max(0, Math.trunc(record.playtimeMinutes * 60_000))
            : undefined;

      await this.store.upsertLibraryItem({
        uri,
        playerDid: did,
        collection,
        rkey,
        cid,
        gameUri,
        status: normalizeShelfStatus(record.status ?? record.shelf),
        favorite: typeof record.favorite === 'boolean' ? record.favorite : undefined,
        rating: typeof record.rating === 'number' ? record.rating : undefined,
        playtimeMs,
        note:
          typeof record.note === 'string'
            ? record.note
            : typeof record.notes === 'string'
              ? record.notes
              : undefined,
        addedAt:
          typeof record.addedAt === 'string'
            ? record.addedAt
            : typeof record.createdAt === 'string'
              ? record.createdAt
              : now,
        rawRecord: record,
        indexedAt: now,
      });
      return { indexed: true, collection };
    }

    switch (collection) {
      case NSIDS.AchievementDefinition: {
        const def = record as AchievementDefinitionRecord;
        if (!def.game) {
          return { indexed: false, collection, error: 'Missing required `game` field on achievement.definition.' };
        }
        if (!def.hidden && (!def.title || !def.description)) {
          return {
            indexed: false,
            collection,
            error: 'Visible achievement.definition requires `title` and `description`.',
          };
        }
        const tlErr = validateTimelockRanges(def.timelocked);
        if (tlErr) {
          return { indexed: false, collection, error: tlErr };
        }
        await this.store.upsertAchievementDefinition({
          uri,
          publisherDid: did,
          rkey,
          cid,
          gameUri: def.game,
          record: def,
          indexedAt: now,
        });
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
        if (!def.game || !def.name || (!def.scoreFormat && !hasComponents) || !def.timeframes || !def.recordPolicy) {
          return { indexed: false, collection, error: 'Missing required leaderboard.definition fields.' };
        }
        const compErr = validateComponentDefs(def.components, def.componentOrder);
        if (compErr) return { indexed: false, collection, error: compErr };
        const dimErr = validateDimensionDefs(def.dimensions, def.dimensionOrder);
        if (dimErr) return { indexed: false, collection, error: dimErr };

        await this.store.upsertLeaderboardDefinition({
          uri,
          publisherDid: did,
          rkey,
          cid,
          gameUri: def.game,
          record: def,
          indexedAt: now,
        });
        return { indexed: true, collection };
      }

      case NSIDS.ChallengeDefinition: {
        const def = record as ChallengeDefinitionRecord;
        if (!def.game || !def.title || !def.cadence) {
          return { indexed: false, collection, error: 'Missing required challenge.definition fields.' };
        }
        await this.store.upsertChallengeDefinition({
          uri,
          publisherDid: did,
          rkey,
          cid,
          gameUri: def.game,
          record: def,
          indexedAt: now,
        });
        return { indexed: true, collection };
      }

      case NSIDS.AchievementUnlock:
        return this.indexUnlockInternal(uri, cid, did, rkey, record as AchievementUnlockRecord);

      case NSIDS.AchievementProgress:
        return this.indexProgressInternal(uri, cid, did, rkey, record as AchievementProgressRecord);

      case NSIDS.LeaderboardScore:
        return this.indexScoreInternal(uri, cid, did, rkey, record as LeaderboardScoreRecord);

      case NSIDS.MatchResult:
        return this.indexMatchInternal(uri, cid, did, rkey, record as MatchResultRecord);

      case NSIDS.Revocation: {
        const rev = record as RevocationRecord;
        if (!rev.scope || !rev.player || !rev.subject || !rev.reason) {
          return { indexed: false, collection, error: 'Missing required revocation fields.' };
        }
        const subjectParsed = parseAtUri(rev.subject);
        if (!subjectParsed) {
          return { indexed: false, collection, error: 'Invalid revocation subject AT-URI.' };
        }

        let isAuthorized = subjectParsed.did === did;
        if (!isAuthorized) {
          const lbDef = await this.store.getLeaderboardDefinition(rev.subject);
          const achDef = await this.store.getAchievementDefinition(rev.subject);
          const chDef = await this.store.getChallengeDefinition(rev.subject);
          const trusted =
            lbDef?.record.trustedIssuers ??
            achDef?.record.trustedIssuers ??
            chDef?.record.trustedIssuers ??
            [];
          isAuthorized = trusted.includes(did);
        }
        if (!isAuthorized) {
          return {
            indexed: false,
            collection,
            error: 'Revocation publisher DID is not authorized for subject URI.',
          };
        }

        await this.store.upsertRevocation({
          uri,
          publisherDid: did,
          rkey,
          cid,
          record: rev,
          indexedAt: now,
        });
        await this.revalidatePublisherRecords([did, subjectParsed.did]);
        return { indexed: true, collection };
      }

      default:
        return { indexed: false, collection };
    }
  }

  private async indexUnlockInternal(
    uri: string,
    cid: string | undefined,
    did: string,
    rkey: string,
    record: AchievementUnlockRecord
  ) {
    if (!record.achievement || !record.unlockedAt) {
      return {
        indexed: false,
        collection: NSIDS.AchievementUnlock,
        verified: false,
        revoked: false,
        error: 'Missing achievement or unlockedAt.',
      };
    }

    const achParsed = parseAtUri(record.achievement);
    const achDef = await this.store.getAchievementDefinition(record.achievement);
    const trustedIssuers = achDef?.record.trustedIssuers ?? [];
    const publisherDid = achParsed?.did;
    const revocations = await this.getRevocationsForPublishers([publisherDid ?? '', ...trustedIssuers]);
    const activeLabels = await this.getActiveLabels([uri, did]);

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowAnyValidIssuer: this.allowAnyValidIssuer,
      allowCommunityLabelVerification: this.allowCommunityLabelVerification,
      revocations,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const activeLabelValues = getRecordLabelValues({
      recordUri: uri,
      recordCid: cid,
      playerDid: did,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
    });

    const isRevoked = !verification.verified && verification.error === 'revoked';
    const isLabelInvalidated = !verification.verified && verification.error === 'label_invalidated';

    await this.store.upsertUnlock({
      uri,
      repositoryDid: did,
      rkey,
      cid,
      gameUri: record.game ?? achDef?.gameUri,
      record,
      verified: verification.verified,
      verificationMethod: verification.verified ? (verification.verificationMethod ?? 'attestation') : undefined,
      verificationError: verification.verified ? undefined : verification.error,
      verificationMessage: verification.verified ? undefined : verification.message,
      issuerDid: verification.issuerDid ?? publisherDid,
      keyId: verification.verified ? verification.keyId : undefined,
      attestationCid: verification.attestationCid,
      revoked: isRevoked,
      revocationReason: !verification.verified ? verification.revocation?.reason : undefined,
      labelInvalidated: isLabelInvalidated,
      activeLabels: activeLabelValues,
      indexedAt: new Date().toISOString(),
    });

    return {
      indexed: true,
      collection: NSIDS.AchievementUnlock,
      verified: verification.verified,
      revoked: isRevoked,
      error: verification.verified ? undefined : verification.error,
    };
  }

  private async indexProgressInternal(
    uri: string,
    cid: string | undefined,
    did: string,
    rkey: string,
    record: AchievementProgressRecord
  ) {
    if (!record.achievement || typeof record.currentSteps !== 'number') {
      return {
        indexed: false,
        collection: NSIDS.AchievementProgress,
        verified: false,
        error: 'Invalid achievement.progress record.',
      };
    }

    const achParsed = parseAtUri(record.achievement);
    const achDef = await this.store.getAchievementDefinition(record.achievement);
    const trustedIssuers = achDef?.record.trustedIssuers ?? [];
    const publisherDid = achParsed?.did;
    const revocations = await this.getRevocationsForPublishers([publisherDid ?? '', ...trustedIssuers]);
    const activeLabels = await this.getActiveLabels([uri, did]);

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowAnyValidIssuer: this.allowAnyValidIssuer,
      revocations,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    await this.store.upsertProgress({
      uri,
      repositoryDid: did,
      rkey,
      cid,
      gameUri: record.game ?? achDef?.gameUri,
      record,
      verified: verification.verified,
      verificationError: verification.verified ? undefined : verification.error,
      issuerDid: verification.issuerDid ?? publisherDid,
      attestationCid: verification.attestationCid,
      revoked: !verification.verified && verification.error === 'revoked',
      labelInvalidated: !verification.verified && verification.error === 'label_invalidated',
      activeLabels: [],
      indexedAt: new Date().toISOString(),
    });

    return {
      indexed: true,
      collection: NSIDS.AchievementProgress,
      verified: verification.verified,
    };
  }

  private async indexScoreInternal(
    uri: string,
    cid: string | undefined,
    did: string,
    rkey: string,
    record: LeaderboardScoreRecord
  ) {
    if (!record.leaderboard || !record.recordedAt) {
      return {
        indexed: false,
        collection: NSIDS.LeaderboardScore,
        verified: false,
        revoked: false,
        error: 'Missing leaderboard or recordedAt.',
      };
    }

    const lbParsed = parseAtUri(record.leaderboard);
    const lbDef = await this.store.getLeaderboardDefinition(record.leaderboard);
    const publisherDid = lbParsed?.did;
    const trustedIssuers = lbDef?.record.trustedIssuers ?? [];

    // Validate bounds, components, dimensions, and active contest window when definition is known
    let validationFailure: string | undefined;
    if (lbDef) {
      const d = lbDef.record;
      if (!isWithinLeaderboardWindow(record.recordedAt, d)) {
        validationFailure = 'Score timestamp is outside leaderboard active window.';
      } else if (typeof record.score === 'number') {
        if (typeof d.scoreMin === 'number' && record.score < d.scoreMin) {
          validationFailure = `Score ${record.score} is below scoreMin ${d.scoreMin}.`;
        } else if (typeof d.scoreMax === 'number' && record.score > d.scoreMax) {
          validationFailure = `Score ${record.score} exceeds scoreMax ${d.scoreMax}.`;
        }
      }
      if (!validationFailure) {
        validationFailure =
          validateScoreComponents(record.components, d) ??
          validateScoreDimensions(record.dimensions, d) ??
          undefined;
      }
    }

    const revocations = await this.getRevocationsForPublishers([publisherDid ?? '', ...trustedIssuers]);
    const activeLabels = await this.getActiveLabels([uri, did]);

    const verification = await verifyRecordAttestation({
      record,
      playerDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowAnyValidIssuer: this.allowAnyValidIssuer,
      allowCommunityLabelVerification: this.allowCommunityLabelVerification,
      revocations,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const activeLabelValues = getRecordLabelValues({
      recordUri: uri,
      recordCid: cid,
      playerDid: did,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
    });

    const isRevoked = !verification.verified && verification.error === 'revoked';
    const isLabelInvalidated = !verification.verified && verification.error === 'label_invalidated';
    const isVerified = verification.verified && !validationFailure;

    await this.store.upsertScore({
      uri,
      repositoryDid: did,
      rkey,
      cid,
      gameUri: record.game ?? lbDef?.gameUri,
      record,
      verified: isVerified,
      verificationMethod: isVerified && verification.verified ? (verification.verificationMethod ?? 'attestation') : undefined,
      verificationError: !verification.verified ? verification.error : undefined,
      verificationMessage: validationFailure ?? (!verification.verified ? verification.message : undefined),
      issuerDid: verification.issuerDid ?? publisherDid,
      keyId: verification.verified ? verification.keyId : undefined,
      attestationCid: verification.attestationCid,
      revoked: isRevoked,
      revocationReason: !verification.verified ? verification.revocation?.reason : undefined,
      labelInvalidated: isLabelInvalidated,
      activeLabels: activeLabelValues,
      indexedAt: new Date().toISOString(),
    });

    return {
      indexed: true,
      collection: NSIDS.LeaderboardScore,
      verified: isVerified,
      revoked: isRevoked,
      error: validationFailure ?? (!verification.verified ? verification.error : undefined),
    };
  }

  private async indexMatchInternal(
    uri: string,
    cid: string | undefined,
    did: string,
    rkey: string,
    record: MatchResultRecord
  ) {
    if (!record.game || !Array.isArray(record.participants) || record.participants.length < 2 || !record.playedAt) {
      return {
        indexed: false,
        collection: NSIDS.MatchResult,
        verified: false,
        revoked: false,
        error: 'Invalid match.result record.',
      };
    }

    const gameParsed = parseAtUri(record.game);
    const publisherDid = gameParsed?.did;
    const lbDef = record.leaderboard ? await this.store.getLeaderboardDefinition(record.leaderboard) : null;
    const trustedIssuers = lbDef?.record.trustedIssuers ?? [];
    const participantDids = record.participants
      .map((p) => p.did)
      .filter((d): d is string => typeof d === 'string' && d.startsWith('did:'));

    const revocations = await this.getRevocationsForPublishers([
      publisherDid ?? '',
      ...trustedIssuers,
      ...participantDids,
    ]);
    const activeLabels = await this.getActiveLabels([uri, did, ...participantDids]);

    const verification = await verifyMatchResult({
      record,
      repositoryDid: did,
      recordUri: uri,
      recordCid: cid,
      expectedIssuerDid: publisherDid,
      trustedIssuerDids: trustedIssuers,
      allowParticipantCoSigning: this.allowParticipantCoSigning,
      allowAnyValidIssuer: this.allowAnyValidIssuer,
      allowCommunityLabelVerification: this.allowCommunityLabelVerification,
      revocations,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
      resolveDidDoc: (issuer) => this.identity.resolveDidDocument(issuer),
    });

    const activeLabelValues = getRecordLabelValues({
      recordUri: uri,
      recordCid: cid,
      playerDid: did,
      activeLabels,
      trustedLabelerDids: this.trustedLabelerDids,
    });

    const isRevoked = !verification.verified && verification.error === 'revoked';
    const isLabelInvalidated = !verification.verified && verification.error === 'label_invalidated';

    await this.store.upsertMatch({
      uri,
      repositoryDid: did,
      rkey,
      cid,
      gameUri: record.game,
      record,
      verified: verification.verified,
      verificationMethod: verification.verified ? verification.verificationMethod : undefined,
      verificationError: verification.verified ? undefined : verification.error,
      verificationMessage: verification.verified ? undefined : verification.message,
      issuerDid: verification.issuerDid ?? publisherDid,
      keyId: verification.verified ? verification.keyId : undefined,
      attestationCid: verification.attestationCid,
      coSigners: verification.verified ? verification.coSigners : undefined,
      revoked: isRevoked,
      revocationReason: !verification.verified ? verification.revocation?.reason : undefined,
      labelInvalidated: isLabelInvalidated,
      activeLabels: activeLabelValues,
      indexedAt: new Date().toISOString(),
    });

    return {
      indexed: true,
      collection: NSIDS.MatchResult,
      verified: verification.verified,
      revoked: isRevoked,
      error: verification.verified ? undefined : verification.error,
    };
  }

  /**
   * Remove a deleted PDS record from the AppView index, reactively re-evaluating player records
   * if a publisher `games.opengaming.revocation` record was deleted (`unrevoke`).
   */
  async deleteRecord(uri: string): Promise<boolean> {
    const parsed = parseAtUri(uri);
    if (!parsed) return false;
    const { did, collection } = parsed;

    if (this.catalogCollections.has(collection)) {
      return this.store.deleteGame(uri);
    }
    if (this.libraryCollections.has(collection)) {
      return this.store.deleteLibraryItem(uri);
    }

    switch (collection) {
      case NSIDS.AchievementDefinition:
        return this.store.deleteAchievementDefinition(uri);
      case NSIDS.LeaderboardDefinition:
        return this.store.deleteLeaderboardDefinition(uri);
      case NSIDS.ChallengeDefinition:
        return this.store.deleteChallengeDefinition(uri);
      case NSIDS.AchievementUnlock:
        return this.store.deleteUnlock(uri);
      case NSIDS.AchievementProgress:
        return this.store.deleteProgress(uri);
      case NSIDS.LeaderboardScore:
        return this.store.deleteScore(uri);
      case NSIDS.MatchResult:
        return this.store.deleteMatch(uri);
      case NSIDS.Revocation: {
        const prev = await this.store.getRevocation(uri);
        const subjectOwner = prev ? parseAtUri(prev.record.subject)?.did : undefined;
        const deleted = await this.store.deleteRevocation(uri);
        if (deleted) {
          await this.revalidatePublisherRecords([did, ...(subjectOwner ? [subjectOwner] : [])]);
        }
        return deleted;
      }
      default:
        return false;
    }
  }

  /**
   * On-demand PDS backfill: resolves a handle or DID, discovers its `#atproto_pds` endpoint,
   * and paginates `com.atproto.repo.listRecords` across all watched catalog, library, and Open Gaming collections.
   */
  async syncActorRepository(
    identifier: string,
    options?: { maxPagesPerCollection?: number }
  ): Promise<{
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

    const pdsUrl = actor.pdsUrl ?? this.defaultPdsUrl;
    const maxPages = options?.maxPagesPerCollection ?? 10;
    const indexedCounts: Record<string, number> = {};
    let totalIndexed = 0;

    for (const collection of this.getWatchedCollections()) {
      let cursor: string | undefined;
      let countForCollection = 0;

      for (let page = 0; page < maxPages; page++) {
        const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set('repo', actor.did);
        url.searchParams.set('collection', collection);
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await this.fetchImpl(url);
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

  /* ============================================================================
   * Standard XRPC & Viewer Query Methods
   * ============================================================================ */

  /**
   * Standard XRPC `games.opengaming.actor.getProfile` query.
   */
  async getActorProfile(actorIdentifier: string): Promise<ActorProfileSummary> {
    const resolved = await this.identity.resolveActor(actorIdentifier);
    const did = resolved?.did ?? (actorIdentifier.startsWith('did:') ? actorIdentifier : '');
    if (!did) {
      throw Object.assign(new Error(`Actor not found: ${actorIdentifier}`), { status: 404 });
    }

    const storedUnlocks = await this.store.listUnlocks({ playerDid: did, verifiedOnly: true });
    const storedDefs = await this.store.listAchievementDefinitions();
    const definitions: DefinitionEntry[] = storedDefs.map((d) => ({
      uri: d.uri,
      record: d.record,
    }));

    return summarizeActorProfile({
      playerDid: did,
      handle: resolved?.handle,
      verifiedUnlocks: storedUnlocks.map((u) => u.record),
      definitions,
    });
  }

  /**
   * Standard XRPC `games.opengaming.leaderboard.getScores` query, supporting `timeframe`,
   * `scope: "public" | "social"`, `viewer`, `player`, `includeObsolete`, `sortBy` multi-component
   * ranking, `dimensions`, `seed`, `version` legality, and co-op `runId` deduplication.
   */
  async getLeaderboardScores({
    leaderboard,
    timeframe = 'allTime',
    scope = 'public',
    viewer,
    player,
    includeObsolete = false,
    sortBy,
    dimensions,
    seed,
    version,
    verifiedOnly = true,
    limit = 25,
    cursor,
    locale = 'en-US',
    now = new Date(),
  }: {
    leaderboard: string;
    timeframe?: Timeframe;
    scope?: 'public' | 'social';
    viewer?: string;
    player?: string;
    includeObsolete?: boolean;
    sortBy?: string;
    dimensions?: string | StringMap;
    seed?: string;
    version?: string;
    verifiedOnly?: boolean;
    limit?: number;
    cursor?: string;
    locale?: string;
    now?: Date;
  }): Promise<LeaderboardGetScoresResponse> {
    const lbStored = await this.store.getLeaderboardDefinition(leaderboard);
    if (!lbStored) {
      throw Object.assign(new Error(`Leaderboard not found: ${leaderboard}`), { status: 404 });
    }

    const parsedDef = lbStored.record;
    const orderedCompIds = getOrderedComponentIds(parsedDef);
    const hasComponents = orderedCompIds.length > 0;
    const rankingMode: RankingMode = parsedDef.rankingMode === 'latest' ? 'latest' : 'best';

    if (sortBy && hasComponents) {
      const requestedComp = parsedDef.components?.[sortBy];
      if (!requestedComp) {
        throw Object.assign(new Error(`Unknown leaderboard component \`sortBy\`: ${sortBy}`), { status: 400 });
      }
      if (requestedComp.$type === 'games.opengaming.leaderboard.definition#text') {
        throw Object.assign(new Error(`Text component \`${sortBy}\` cannot be used for ranking.`), { status: 400 });
      }
    }

    const effectiveSortedBy = hasComponents
      ? sortBy ?? parsedDef.defaultComponent ?? orderedCompIds[0]
      : undefined;

    const allowedTimeframes = parsedDef.timeframes ?? ['allTime'];
    const effectiveTimeframe: Timeframe = allowedTimeframes.includes(timeframe)
      ? timeframe
      : allowedTimeframes[0] ?? 'allTime';

    const fallbackSortOrder: LeaderboardSortOrder = parsedDef.sortOrder ?? 'largerIsBetter';
    const scoreFormat: ScoreFormat = parsedDef.scoreFormat ?? { kind: 'numeric', decimalPlaces: 0 };
    const windowStartMs = getTimeframeStartMs(effectiveTimeframe, now);
    const parsedDimFilter = parseDimensionsFilter(dimensions);
    const hasDimFilter = Object.keys(parsedDimFilter).length > 0;

    let resolvedViewerDid: string | undefined;
    if (viewer) {
      const v = await this.identity.resolveActor(viewer);
      resolvedViewerDid = v?.did ?? (viewer.startsWith('did:') ? viewer : undefined);
    }

    let resolvedPlayerDid: string | undefined;
    if (player) {
      const p = await this.identity.resolveActor(player);
      resolvedPlayerDid = p?.did ?? (player.startsWith('did:') ? player : undefined);
      if (!resolvedPlayerDid) {
        return {
          leaderboard,
          ...(effectiveSortedBy ? { sortedBy: effectiveSortedBy } : {}),
          rankingMode,
          entries: [],
        };
      }
    }

    let socialDids: Set<string> | null = null;
    if (scope === 'social') {
      if (!resolvedViewerDid) {
        throw Object.assign(new Error('`viewer` parameter is required when `scope` is "social".'), { status: 400 });
      }
      socialDids = await this.identity.getSocialGraphDids(resolvedViewerDid);
    }

    const rawScores = await this.store.listScores({ leaderboardUri: leaderboard });

    interface ExtractedRow {
      stored: StoredVerifiedRecord<LeaderboardScoreRecord>;
      sortableValue: number;
      sortOrder: LeaderboardSortOrder;
      displayScore: string;
      components?: ScoreComponentValMap;
      dimensions?: StringMap;
      seed?: string;
      participants?: Participant[];
      runId?: string;
      competitorKey: string;
      obsolete?: boolean;
    }

    const rowIncludesDid = (playerDid: string, participants: Participant[] | undefined, targetDid: string) =>
      playerDid === targetDid || Boolean(participants?.some((p) => p?.did === targetDid));

    const extractedRows: ExtractedRow[] = [];
    for (const s of rawScores) {
      const rec = s.record;
      const ts = Date.parse(rec.recordedAt);
      if (!Number.isNaN(ts) && ts < windowStartMs) continue;
      if (!isWithinLeaderboardWindow(rec.recordedAt, parsedDef)) continue;
      if (verifiedOnly && (!s.verified || s.revoked)) continue;
      if (hasDimFilter && !matchesDimensionFilter(rec.dimensions, parsedDimFilter)) continue;
      if (seed !== undefined && rec.seed !== seed) continue;

      if (version) {
        if (rec.version !== version) continue;
      } else if (parsedDef.rankedVersions && parsedDef.rankedVersions.length > 0) {
        if (!isVersionLegal(rec.version, parsedDef.rankedVersions)) continue;
      }

      const playerDid = s.repositoryDid;
      if (socialDids) {
        const inSocial =
          socialDids.has(playerDid) ||
          Boolean(rec.participants?.some((p) => p?.did && socialDids!.has(p.did)));
        if (!inSocial) continue;
      }

      const partyKeys =
        rec.participants && rec.participants.length >= 2
          ? [...new Set(rec.participants.map((p) => p.did || p.name || '').filter(Boolean))].sort()
          : [];
      const competitorKey = partyKeys.length >= 2 ? `party:${partyKeys.join('+')}` : `player:${playerDid}`;

      if (hasComponents) {
        const metric = getScoreSortMetric(rec, parsedDef, effectiveSortedBy, locale);
        if (!metric) continue;
        extractedRows.push({
          stored: s,
          sortableValue: Math.trunc(metric.sortableValue),
          sortOrder: metric.sortOrder,
          displayScore: metric.displayValue,
          components: rec.components,
          dimensions: rec.dimensions,
          seed: rec.seed,
          participants: rec.participants,
          runId: rec.runId,
          competitorKey,
        });
      } else {
        if (typeof rec.score !== 'number') continue;
        const rawVal = Math.trunc(rec.score);
        extractedRows.push({
          stored: s,
          sortableValue: rawVal,
          sortOrder: fallbackSortOrder,
          displayScore: rec.displayScore ?? formatScore(rawVal, scoreFormat, locale),
          components: rec.components,
          dimensions: rec.dimensions,
          seed: rec.seed,
          participants: rec.participants,
          runId: rec.runId,
          competitorKey,
        });
      }
    }

    // 1. Co-op `runId` deduplication
    const dedupedByRunId: ExtractedRow[] = [];
    const seenRunIds = new Map<string, number>();
    const preferredDid = resolvedPlayerDid ?? resolvedViewerDid;
    for (const item of extractedRows) {
      if (!item.runId) {
        dedupedByRunId.push(item);
        continue;
      }
      const existingIdx = seenRunIds.get(item.runId);
      if (existingIdx === undefined) {
        seenRunIds.set(item.runId, dedupedByRunId.length);
        dedupedByRunId.push(item);
      } else {
        const prev = dedupedByRunId[existingIdx];
        const itemPreferred = preferredDid && item.stored.repositoryDid === preferredDid;
        const prevPreferred = preferredDid && prev.stored.repositoryDid === preferredDid;
        if (
          (itemPreferred && !prevPreferred) ||
          (!prevPreferred && item.stored.uri.localeCompare(prev.stored.uri) < 0)
        ) {
          dedupedByRunId[existingIdx] = item;
        }
      }
    }

    // 2. Active vs obsolete determination per competitor
    const isSuperseding = (candidate: ExtractedRow, incumbent: ExtractedRow): boolean => {
      const candTs = Date.parse(candidate.stored.record.recordedAt);
      const incTs = Date.parse(incumbent.stored.record.recordedAt);
      if (rankingMode === 'latest') {
        if (candTs !== incTs) return candTs > incTs;
        if (candidate.sortableValue !== incumbent.sortableValue) {
          return isBetterScore(candidate.sortableValue, incumbent.sortableValue, candidate.sortOrder);
        }
        return candidate.stored.uri.localeCompare(incumbent.stored.uri) < 0;
      }
      if (isBetterScore(candidate.sortableValue, incumbent.sortableValue, candidate.sortOrder)) {
        return true;
      }
      if (candidate.sortableValue === incumbent.sortableValue) {
        if (candTs !== incTs) return candTs < incTs;
        return candidate.stored.uri.localeCompare(incumbent.stored.uri) < 0;
      }
      return false;
    };

    const activeByCompetitor = new Map<string, ExtractedRow>();
    for (const item of dedupedByRunId) {
      const prev = activeByCompetitor.get(item.competitorKey);
      if (!prev || isSuperseding(item, prev)) {
        activeByCompetitor.set(item.competitorKey, item);
      }
    }

    const activeUris = new Set([...activeByCompetitor.values()].map((i) => i.stored.uri));
    for (const item of dedupedByRunId) {
      item.obsolete = !activeUris.has(item.stored.uri);
    }

    const compareEntries = (a: ExtractedRow, b: ExtractedRow): number => {
      if (a.sortableValue !== b.sortableValue) {
        return a.sortOrder === 'smallerIsBetter'
          ? a.sortableValue - b.sortableValue
          : b.sortableValue - a.sortableValue;
      }
      const tsDiff =
        Date.parse(a.stored.record.recordedAt) - Date.parse(b.stored.record.recordedAt);
      if (tsDiff !== 0) return rankingMode === 'latest' ? -tsDiff : tsDiff;
      return a.stored.uri.localeCompare(b.stored.uri);
    };

    const toScoreEntry = async (item: ExtractedRow, rank: number): Promise<LeaderboardScoreViewEntry> => {
      const s = item.stored;
      const actor = await this.store.getActor(s.repositoryDid);
      const replayBlob = extractBlobInfo(s.record.replay);

      return {
        rank,
        player: s.repositoryDid,
        ...(actor?.handle ? { handle: actor.handle } : {}),
        ...(actor?.displayName ? { displayName: actor.displayName } : {}),
        ...(actor?.avatarUrl ? { avatarUrl: actor.avatarUrl } : {}),
        uri: s.uri,
        ...(s.attestationCid ? { attestationCid: s.attestationCid } : {}),
        ...(s.issuerDid ? { issuer: s.issuerDid } : {}),
        score: item.sortableValue,
        displayScore: item.displayScore,
        ...(item.components && Object.keys(item.components).length > 0 ? { components: item.components } : {}),
        ...(item.dimensions && Object.keys(item.dimensions).length > 0 ? { dimensions: item.dimensions } : {}),
        ...(item.seed ? { seed: item.seed } : {}),
        ...(item.participants && item.participants.length > 0 ? { participants: item.participants } : {}),
        ...(item.runId ? { runId: item.runId } : {}),
        ...(s.record.version ? { version: s.record.version } : {}),
        ...(replayBlob.cid ? { hasReplay: true, replayCid: replayBlob.cid } : {}),
        ...(s.record.tag ? { tag: s.record.tag } : {}),
        ...(s.activeLabels.length > 0 ? { labels: s.activeLabels } : {}),
        recordedAt: s.record.recordedAt,
        verified: s.verified && !s.revoked,
        ...(item.obsolete ? { obsolete: true } : {}),
        ...(!verifiedOnly ? { revoked: s.revoked } : {}),
      };
    };

    const sortedActiveAll = [...activeByCompetitor.values()].sort(compareEntries);
    const activeRankByUri = new Map<string, number>();
    sortedActiveAll.forEach((item, idx) => activeRankByUri.set(item.stored.uri, idx + 1));

    let viewerEntry: LeaderboardScoreViewEntry | undefined;
    if (resolvedViewerDid) {
      const viewerActive = sortedActiveAll.find(
        (item) =>
          !item.stored.revoked &&
          rowIncludesDid(item.stored.repositoryDid, item.participants, resolvedViewerDid!)
      );
      if (viewerActive) {
        viewerEntry = await toScoreEntry(
          viewerActive,
          activeRankByUri.get(viewerActive.stored.uri) ?? 1
        );
      }
    }

    let pool = includeObsolete ? dedupedByRunId : sortedActiveAll;
    if (resolvedPlayerDid) {
      pool = pool.filter((item) =>
        rowIncludesDid(item.stored.repositoryDid, item.participants, resolvedPlayerDid!)
      );
    }

    const sortedPool = [...pool].sort(compareEntries);
    const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const sliced = sortedPool.slice(offset, offset + boundedLimit);
    const nextCursor = offset + boundedLimit < sortedPool.length ? String(offset + boundedLimit) : undefined;

    const entries: LeaderboardScoreViewEntry[] = [];
    for (let i = 0; i < sliced.length; i++) {
      const item = sliced[i];
      const rank =
        !includeObsolete && !resolvedPlayerDid
          ? offset + i + 1
          : activeRankByUri.get(item.stored.uri) ?? offset + i + 1;
      entries.push(await toScoreEntry(item, rank));
    }

    return {
      leaderboard,
      ...(effectiveSortedBy ? { sortedBy: effectiveSortedBy } : {}),
      rankingMode,
      entries,
      ...(viewerEntry ? { viewerEntry } : {}),
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };
  }

  /**
   * Unified Player Game Library query: combines explicit ATmosphere shelf/library records
   * (`games.atmosphere.library.*` / `games.gamesgamesgamesgames.*`) with verified Open Gaming
   * achievements, leaderboard PBs, and PvP match participation.
   */
  async getActorLibrary({
    actor,
    shelf,
    sortBy = 'recentActivity',
    locale,
  }: {
    actor: string;
    shelf?: LibraryShelfStatus;
    sortBy?: 'recentActivity' | 'completion' | 'title';
    locale?: string;
  }): Promise<ActorGameLibraryResponse> {
    const resolved = await this.identity.resolveActor(actor);
    const did = resolved?.did ?? (actor.startsWith('did:') ? actor : '');
    if (!did) {
      throw Object.assign(new Error(`Actor not found: ${actor}`), { status: 404 });
    }

    const [shelfItems, unlocks, scores, matches, allAchDefs, allLbDefs] = await Promise.all([
      this.store.listLibraryItemsByPlayer(did),
      this.store.listUnlocks({ playerDid: did, verifiedOnly: true }),
      this.store.listScores({ playerDid: did, verifiedOnly: true }),
      this.store.listMatches({ actorDid: did, verifiedOnly: true }),
      this.store.listAchievementDefinitions(),
      this.store.listLeaderboardDefinitions(),
    ]);

    const achDefByUri = new Map(allAchDefs.map((d) => [d.uri, d]));
    const lbDefByUri = new Map(allLbDefs.map((d) => [d.uri, d]));
    const defsByGame = new Map<string, DefinitionEntry[]>();
    for (const d of allAchDefs) {
      const list = defsByGame.get(d.gameUri) ?? [];
      list.push({ uri: d.uri, record: d.record });
      defsByGame.set(d.gameUri, list);
    }

    const gameUris = new Set<string>();
    const shelfByGame = new Map(shelfItems.map((s) => [s.gameUri, s]));
    for (const s of shelfItems) gameUris.add(s.gameUri);
    for (const u of unlocks) {
      const g = u.gameUri ?? achDefByUri.get(u.record.achievement)?.gameUri;
      if (g) gameUris.add(g);
    }
    for (const sc of scores) {
      const g = sc.gameUri ?? lbDefByUri.get(sc.record.leaderboard)?.gameUri;
      if (g) gameUris.add(g);
    }
    for (const m of matches) {
      if (m.record.game) gameUris.add(m.record.game);
    }

    const allUnlockRecords = unlocks.map((u) => u.record);
    const shelvesCount: Record<string, number> = {};
    const items: ActorGameLibraryItem[] = [];

    for (const gameUri of gameUris) {
      const gameEntry = await this.store.getGame(gameUri);
      const shelfEntry = shelfByGame.get(gameUri);
      const gameAchDefs = defsByGame.get(gameUri) ?? [];
      const completion = calculateGameCompletion({
        game: gameUri,
        verifiedUnlocks: allUnlockRecords,
        definitions: gameAchDefs,
      });

      const gameScores = scores.filter(
        (sc) => (sc.gameUri ?? lbDefByUri.get(sc.record.leaderboard)?.gameUri) === gameUri
      );
      const bestByLb = new Map<string, ActorLibraryPersonalBest>();
      for (const sc of gameScores) {
        const lbDef = lbDefByUri.get(sc.record.leaderboard);
        if (!lbDef) continue;
        const metric = getScoreSortMetric(sc.record, lbDef.record, undefined, locale ?? 'en-US');
        if (!metric) continue;
        const prev = bestByLb.get(sc.record.leaderboard);
        if (!prev || isBetterScore(metric.sortableValue, prev.score, metric.sortOrder)) {
          const localizedLb = resolveTranslation(lbDef.record, locale);
          bestByLb.set(sc.record.leaderboard, {
            leaderboardUri: sc.record.leaderboard,
            leaderboardName: localizedLb.name ?? lbDef.record.name,
            score: metric.sortableValue,
            displayScore: metric.displayValue,
            recordedAt: sc.record.recordedAt,
          });
        }
      }

      // Deduplicate co-signed PvP matches by matchId
      const seenMatchKeys = new Set<string>();
      let matchesPlayed = 0;
      let matchWins = 0;
      let latestMatchAt: string | undefined;

      for (const m of matches) {
        if (m.record.game !== gameUri) continue;
        const mKey = m.record.matchId ? `${gameUri}|${m.record.matchId}` : m.uri;
        if (seenMatchKeys.has(mKey)) continue;
        seenMatchKeys.add(mKey);
        matchesPlayed += 1;
        const pEntry = m.record.participants.find((p) => p.did === did);
        if (pEntry?.outcome === 'win') matchWins += 1;
        if (!latestMatchAt || Date.parse(m.record.playedAt) > Date.parse(latestMatchAt)) {
          latestMatchAt = m.record.playedAt;
        }
      }

      const sources: LibraryItemSource[] = [];
      if (shelfEntry) sources.push('shelf');
      if (completion.unlockedCount > 0 || (completion.bonusUnlockedCount ?? 0) > 0) {
        sources.push('achievements');
      }
      if (bestByLb.size > 0) sources.push('leaderboards');
      if (matchesPlayed > 0) sources.push('matches');

      const inferredStatus: LibraryShelfStatus = shelfEntry
        ? shelfEntry.status
        : completion.completed
          ? 'completed'
          : 'playing';

      shelvesCount[inferredStatus] = (shelvesCount[inferredStatus] ?? 0) + 1;

      if (shelf && inferredStatus !== shelf) {
        continue;
      }

      const candidateTimestamps = [
        shelfEntry?.addedAt,
        completion.latestUnlockAt,
        ...[...bestByLb.values()].map((b) => b.recordedAt),
        latestMatchAt,
      ].filter((t): t is string => Boolean(t));

      let lastActivityAt: string | undefined;
      for (const ts of candidateTimestamps) {
        if (!lastActivityAt || Date.parse(ts) > Date.parse(lastActivityAt)) {
          lastActivityAt = ts;
        }
      }

      const fallbackSlug = gameUri.split('/').pop() ?? gameUri;
      items.push({
        gameUri,
        name: gameEntry?.name ?? fallbackSlug,
        tagline: gameEntry?.tagline,
        description: gameEntry?.description,
        iconUrl: gameEntry?.iconUrl,
        url: gameEntry?.url,
        developerName: gameEntry?.developerName,
        shelfStatus: inferredStatus,
        favorite: shelfEntry?.favorite,
        rating: shelfEntry?.rating,
        playtimeMs: shelfEntry?.playtimeMs,
        shelfNote: shelfEntry?.note,
        shelfRecordUri: shelfEntry?.uri,
        sources,
        achievements: completion,
        personalBests: [...bestByLb.values()],
        matchesPlayed,
        matchWins,
        lastActivityAt,
      });
    }

    items.sort((a, b) => {
      if (sortBy === 'title') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'completion') {
        if (b.achievements.completionPercent !== a.achievements.completionPercent) {
          return b.achievements.completionPercent - a.achievements.completionPercent;
        }
      }
      const tA = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
      const tB = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
      if (tB !== tA) return tB - tA;
      return a.name.localeCompare(b.name);
    });

    return {
      did,
      handle: resolved?.handle,
      displayName: resolved?.displayName,
      avatarUrl: resolved?.avatarUrl,
      totalGames: Object.values(shelvesCount).reduce((sum, n) => sum + n, 0),
      shelves: shelvesCount,
      items,
    };
  }

  /**
   * List all indexed games in the catalog with definition & active player counts.
   */
  async getGamesCatalog(): Promise<
    Array<{
      uri: string;
      publisherDid: string;
      name: string;
      tagline?: string;
      description?: string;
      url?: string;
      category?: string;
      status?: string;
      iconUrl?: string;
      developerName?: string;
      achievementCount: number;
      leaderboardCount: number;
      activePlayersCount: number;
    }>
  > {
    const games = await this.store.listGames();
    const results = [];
    for (const g of games) {
      const [achDefs, lbDefs, unlocks, scores, matches, shelfItems] = await Promise.all([
        this.store.listAchievementDefinitions(g.uri),
        this.store.listLeaderboardDefinitions(g.uri),
        this.store.listUnlocks({ gameUri: g.uri, verifiedOnly: true }),
        this.store.listScores({ gameUri: g.uri, verifiedOnly: true }),
        this.store.listMatches({ gameUri: g.uri, verifiedOnly: true }),
        this.store.listLibraryItemsByGame(g.uri),
      ]);

      const playerSet = new Set<string>();
      for (const u of unlocks) playerSet.add(u.repositoryDid);
      for (const s of scores) playerSet.add(s.repositoryDid);
      for (const m of matches) {
        for (const p of m.record.participants) {
          if (p.did) playerSet.add(p.did);
        }
      }
      for (const li of shelfItems) playerSet.add(li.playerDid);

      results.push({
        uri: g.uri,
        publisherDid: g.publisherDid,
        name: g.name,
        tagline: g.tagline,
        description: g.description,
        url: g.url,
        category: g.category,
        status: g.status,
        iconUrl: g.iconUrl,
        developerName: g.developerName,
        achievementCount: achDefs.length,
        leaderboardCount: lbDefs.length,
        activePlayersCount: playerSet.size,
      });
    }
    return results;
  }

  /**
   * Rich Game Hub view: returns game metadata, global achievement unlock rarity `%`,
   * spoiler-safe `ViewerAchievementCard[]` (unmasked when `viewer` has unlocked them),
   * active challenges, leaderboards, and recent PvP matches.
   */
  async getGameDetail({
    gameUri,
    viewer,
    locale,
    now = new Date(),
  }: {
    gameUri: string;
    viewer?: string;
    locale?: string;
    now?: Date;
  }): Promise<GameHubView> {
    const game = await this.store.getGame(gameUri);
    if (!game) {
      throw Object.assign(new Error(`Game not found: ${gameUri}`), { status: 404 });
    }

    let viewerDid: string | undefined;
    if (viewer) {
      const resolved = await this.identity.resolveActor(viewer);
      viewerDid = resolved?.did ?? (viewer.startsWith('did:') ? viewer : undefined);
    }

    const [achDefs, lbDefs, chDefs, gameUnlocks, gameScores, gameMatches, viewerProgress] =
      await Promise.all([
        this.store.listAchievementDefinitions(gameUri),
        this.store.listLeaderboardDefinitions(gameUri),
        this.store.listChallengeDefinitions(gameUri),
        this.store.listUnlocks({ gameUri, verifiedOnly: true }),
        this.store.listScores({ gameUri, verifiedOnly: true }),
        this.store.listMatches({ gameUri, verifiedOnly: true }),
        viewerDid ? this.store.listProgress({ playerDid: viewerDid, gameUri }) : Promise.resolve([]),
      ]);

    // Also include unlocks referencing achievement URIs of this game even if `unlock.game` was omitted
    const achUriSet = new Set(achDefs.map((d) => d.uri));
    const allMatchingUnlocks = [
      ...new Map(
        [
          ...gameUnlocks,
          ...(
            await Promise.all(
              achDefs.map((d) => this.store.listUnlocks({ achievementUri: d.uri, verifiedOnly: true }))
            )
          ).flat(),
        ].map((u) => [u.uri, u] as const)
      ).values(),
    ].filter((u) => achUriSet.has(u.record.achievement));

    const totalPlayersSet = new Set<string>();
    for (const u of allMatchingUnlocks) totalPlayersSet.add(u.repositoryDid);
    for (const s of gameScores) totalPlayersSet.add(s.repositoryDid);
    for (const m of gameMatches) {
      for (const p of m.record.participants) {
        if (p.did) totalPlayersSet.add(p.did);
      }
    }
    const totalPlayers = Math.max(totalPlayersSet.size, allMatchingUnlocks.length > 0 ? 1 : 0);

    const viewerUnlocksByAch = new Map<string, StoredVerifiedRecord<AchievementUnlockRecord>>();
    if (viewerDid) {
      for (const u of allMatchingUnlocks) {
        if (u.repositoryDid === viewerDid) {
          viewerUnlocksByAch.set(u.record.achievement, u);
        }
      }
    }

    const viewerProgByAch = new Map<string, number>();
    for (const p of viewerProgress) {
      if (p.verified && !p.revoked) {
        viewerProgByAch.set(p.record.achievement, p.record.currentSteps);
      }
    }

    const sortedDefs = sortAchievementDefinitions(
      achDefs.map((d) => ({ uri: d.uri, record: d.record }))
    );
    const nowIso = now.toISOString();

    const achievements: ViewerAchievementCard[] = sortedDefs.map(({ uri, record: def }) => {
      const parsedOwner = parseAtUri(uri)?.did ?? game.publisherDid;
      const earners = new Set(
        allMatchingUnlocks.filter((u) => u.record.achievement === uri).map((u) => u.repositoryDid)
      );
      const viewerUnlock = viewerUnlocksByAch.get(uri);
      const viewerUnlocked = Boolean(viewerUnlock);
      const isRedactedStub = Boolean(def.hidden && (!def.title || !def.description));
      const shouldMask = Boolean(def.hidden && !viewerUnlocked);

      const localized = resolveTranslation(def, locale);
      const iconBlob = extractBlobInfo(def.icon);
      const lockedBlob = extractBlobInfo(def.lockedIcon);
      const chosenCid = shouldMask ? lockedBlob.cid : (iconBlob.cid ?? lockedBlob.cid);

      const title = shouldMask
        ? 'Hidden Achievement'
        : (localized.title ?? def.title ?? 'Hidden Achievement');
      const description = shouldMask
        ? def.hiddenSpace
          ? 'Spoiler-protected stub — unlock in-game to reveal details.'
          : 'Keep playing to discover and unlock this hidden milestone.'
        : (localized.description ??
          def.description ??
          (isRedactedStub ? 'Spoiler-protected achievement unlocked.' : ''));

      const rarityPercent =
        totalPlayers === 0 ? 0 : Math.round((earners.size / totalPlayers) * 1000) / 10;

      return {
        uri,
        game: gameUri,
        title,
        description,
        ...(!shouldMask && localized.requirement ? { requirement: localized.requirement } : {}),
        ...(!shouldMask && localized.tooltip ? { tooltip: localized.tooltip } : {}),
        iconUrl: this.makeBlobProxyUrl(parsedOwner, chosenCid),
        iconAlt: shouldMask ? 'Locked hidden achievement' : def.iconAlt,
        tier: def.tier,
        hidden: Boolean(def.hidden),
        hiddenSpace: def.hiddenSpace,
        isMaskedSpoiler: shouldMask,
        completionOptional: isCompletionOptional(def),
        repeatable: Boolean(def.repeatable),
        retired: Boolean(def.retired),
        timelocked: def.timelocked,
        timelockActive: isWithinTimelock(nowIso, def.timelocked),
        stepsNeeded: def.stepsNeeded,
        group: def.group,
        listOrder: def.listOrder,
        unlockedPlayersCount: earners.size,
        rarityPercent,
        viewerUnlocked,
        viewerUnlockedAt: viewerUnlock?.record.unlockedAt,
        viewerUnlockUri: viewerUnlock?.uri,
        viewerCurrentSteps: viewerUnlocked ? def.stepsNeeded : viewerProgByAch.get(uri),
      };
    });

    const viewerCompletion = viewerDid
      ? calculateGameCompletion({
          game: gameUri,
          verifiedUnlocks: [...viewerUnlocksByAch.values()].map((u) => u.record),
          definitions: sortedDefs,
        })
      : undefined;

    const leaderboards = await Promise.all(
      lbDefs.map(async (lb) => {
        const lbScores = await this.store.listScores({ leaderboardUri: lb.uri, verifiedOnly: true });
        const iconBlob = extractBlobInfo(lb.record.icon);
        const localized = resolveTranslation(lb.record, locale);
        return {
          uri: lb.uri,
          name: localized.name ?? lb.record.name,
          description: localized.description ?? lb.record.description,
          iconUrl: this.makeBlobProxyUrl(lb.publisherDid, iconBlob.cid),
          sortOrder: lb.record.sortOrder ?? 'largerIsBetter',
          rankingMode: (lb.record.rankingMode === 'latest' ? 'latest' : 'best') as RankingMode,
          scoreFormat: lb.record.scoreFormat,
          timeframes: lb.record.timeframes,
          recordPolicy: lb.record.recordPolicy,
          totalVerifiedEntries: lbScores.length,
        };
      })
    );

    const challenges = chDefs.map((ch) => {
      const localized = resolveTranslation(ch.record, locale);
      return {
        uri: ch.uri,
        title: localized.title ?? ch.record.title,
        description: localized.description ?? ch.record.description,
        cadence: ch.record.cadence,
        seed: ch.record.seed,
        leaderboard: ch.record.leaderboard,
        rewardAchievement: ch.record.rewardAchievement,
        startsAt: ch.record.startsAt,
        endsAt: ch.record.endsAt,
        active: isWithinLeaderboardWindow(nowIso, ch.record),
      };
    });

    const matchHistory = await this.getMatchHistory({ gameUri, limit: 10 });

    return {
      game: {
        uri: game.uri,
        publisherDid: game.publisherDid,
        name: game.name,
        tagline: game.tagline,
        description: game.description,
        url: game.url,
        category: game.category,
        status: game.status,
        iconUrl: game.iconUrl,
        developerName: game.developerName,
        totalPlayers,
      },
      ...(viewerCompletion ? { viewerCompletion } : {}),
      achievements,
      leaderboards,
      challenges,
      recentMatches: matchHistory.matches,
    };
  }

  /**
   * Query verified PvP/competitive match history, deduplicating multi-participant co-signed
   * receipts sharing `(game, matchId)`.
   */
  async getMatchHistory({
    gameUri,
    actor,
    leaderboardUri,
    limit = 25,
    cursor,
  }: {
    gameUri?: string;
    actor?: string;
    leaderboardUri?: string;
    limit?: number;
    cursor?: string;
  }): Promise<MatchHistoryResponse> {
    let actorDid: string | undefined;
    if (actor) {
      const resolved = await this.identity.resolveActor(actor);
      actorDid = resolved?.did ?? (actor.startsWith('did:') ? actor : undefined);
      if (!actorDid) return { matches: [] };
    }

    const storedMatches = await this.store.listMatches({
      gameUri,
      actorDid,
      leaderboardUri,
      verifiedOnly: true,
    });

    const deduped = new Map<string, StoredVerifiedRecord<MatchResultRecord>>();
    for (const m of storedMatches) {
      const key = m.record.matchId ? `${m.record.game}|${m.record.matchId}` : m.uri;
      const existing = deduped.get(key);
      if (!existing || m.uri.localeCompare(existing.uri) < 0) {
        deduped.set(key, m);
      }
    }

    const sorted = [...deduped.values()].sort(
      (a, b) => Date.parse(b.record.playedAt) - Date.parse(a.record.playedAt)
    );

    const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const sliced = sorted.slice(offset, offset + boundedLimit);
    const nextCursor = offset + boundedLimit < sorted.length ? String(offset + boundedLimit) : undefined;

    const matches: MatchHistoryEntry[] = [];
    for (const m of sliced) {
      const game = await this.store.getGame(m.record.game);
      const participants = await Promise.all(
        m.record.participants.map(async (p) => {
          if (!p.did) return p;
          const meta = await this.store.getActor(p.did);
          return {
            ...p,
            ...(meta?.handle ? { handle: meta.handle } : {}),
            ...(meta?.displayName ? { displayName: meta.displayName } : {}),
            ...(meta?.avatarUrl ? { avatarUrl: meta.avatarUrl } : {}),
          };
        })
      );

      matches.push({
        uri: m.uri,
        gameUri: m.record.game,
        ...(game?.name ? { gameName: game.name } : {}),
        ...(m.record.matchId ? { matchId: m.record.matchId } : {}),
        ...(m.record.mode ? { mode: m.record.mode } : {}),
        ...(m.record.leaderboard ? { leaderboardUri: m.record.leaderboard } : {}),
        participants,
        playedAt: m.record.playedAt,
        verified: m.verified && !m.revoked,
        ...(m.verificationMethod ? { verificationMethod: m.verificationMethod } : {}),
        ...(m.attestationCid ? { attestationCid: m.attestationCid } : {}),
      });
    }

    return {
      matches,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };
  }
}
