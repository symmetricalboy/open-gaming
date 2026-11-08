import {
  NSIDS,
  createRevocationRecord,
  createSignedProgress,
  createSignedScore,
  createSignedUnlock,
  generateSigningKeys,
  getUnlockRkey,
} from '@opengaming/sdk';
import type { AppDatabase } from './db.js';
import type { IdentityService } from './identity.js';
import type { OpenGamingIndexer } from './indexer.js';

const DUMMY_BLOB = (cid: string) => ({
  $type: 'blob' as const,
  ref: { $link: cid },
  mimeType: 'image/png',
  size: 48210,
});

const CID_1 = 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori';
const CID_2 = 'bafkreig7dkulj7gxbtieaphkqdhyyok4egzjqljfxm7z34qoelajngbwqm';
const CID_3 = 'bafkreib7ld225myegtu43hwl4fmw3jfwajncfx3uycidwu7u67zu6l2hoa';
const CID_4 = 'bafkreie3g7qzowpxuzraqa4irir3hbnnmwbmlyhkx4bcgbhj45cz5ux4re';

export async function seedShowcaseData({
  db,
  identity,
  indexer,
}: {
  db: AppDatabase;
  identity: IdentityService;
  indexer: OpenGamingIndexer;
}): Promise<void> {
  const existingGames = (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c;
  if (existingGames > 0) {
    return;
  }

  // Generate real P-256 ECDSA attestation keys for two reference game publishers!
  const flappyKeys = await generateSigningKeys();
  const driftKeys = await generateSigningKeys();

  const FLAPPY_DID = 'did:plc:flappyskygameexample';
  const DRIFT_DID = 'did:plc:neondriftgameexample';

  const DYLAN_DID = 'did:plc:33d7gnwiagm6cimpiepefp72';
  const TREZY_DID = 'did:plc:4jrld6fwpnwqehtce56qshzv';
  const BOBA_DID = 'did:plc:r2vpg2iszskbkegoldmqa322';
  const BAILEY_DID = 'did:plc:rnpkyqnmsw4ipey6eotbdnnf';
  const CHEATER_DID = 'did:plc:cheaterglitchbot0000';

  // Register publisher & player identities (with real verificationMethods.attestations on game DIDs)
  identity.upsertActor({
    did: FLAPPY_DID,
    handle: 'flappysky.symmetricalboy.com',
    displayName: 'Flappysky',
    didDoc: {
      id: FLAPPY_DID,
      alsoKnownAs: ['at://flappysky.symmetricalboy.com'],
      verificationMethods: { attestations: flappyKeys.publicDidKey },
    },
    isDemo: true,
  });

  identity.upsertActor({
    did: DRIFT_DID,
    handle: 'neondrift.opengaming.games',
    displayName: 'Neon Drift 2086',
    didDoc: {
      id: DRIFT_DID,
      alsoKnownAs: ['at://neondrift.opengaming.games'],
      verificationMethods: { attestations: driftKeys.publicDidKey },
    },
    isDemo: true,
  });

  identity.upsertActor({
    did: DYLAN_DID,
    handle: 'symmetricalboy.com',
    displayName: 'symmetricalboy',
    isDemo: true,
  });
  identity.upsertActor({
    did: TREZY_DID,
    handle: 'trezy.codes',
    displayName: 'Trezy',
    isDemo: true,
  });
  identity.upsertActor({
    did: BOBA_DID,
    handle: 'essentialrandom.bsky.social',
    displayName: 'Ms Boba',
    isDemo: true,
  });
  identity.upsertActor({
    did: BAILEY_DID,
    handle: 'pds.dad',
    displayName: 'Bailey Townsend',
    isDemo: true,
  });
  identity.upsertActor({
    did: CHEATER_DID,
    handle: 'frameglitcher.bsky.social',
    displayName: 'FrameGlitcher',
    isDemo: true,
  });

  // Seed social graph for Social Leaderboards (`scope: "social"`)
  const insertFollow = db.prepare('INSERT OR IGNORE INTO follows (follower_did, subject_did) VALUES (?, ?)');
  insertFollow.run(DYLAN_DID, TREZY_DID);
  insertFollow.run(DYLAN_DID, BOBA_DID);
  insertFollow.run(DYLAN_DID, BAILEY_DID);
  insertFollow.run(TREZY_DID, DYLAN_DID);
  insertFollow.run(TREZY_DID, BOBA_DID);

  const nowMs = Date.now();
  const isoAgo = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();
  const daysAgo = (d: number) => new Date(nowMs - d * 86_400_000).toISOString();

  // 1. Game #1: Flappysky
  const FLAPPY_GAME_URI = `at://${FLAPPY_DID}/games.atmosphere.define/flappysky`;
  await indexer.indexRecord({
    uri: FLAPPY_GAME_URI,
    isDemo: true,
    iconUrlOverride: '/assets/icons/game-flappysky.svg',
    record: {
      $type: 'games.atmosphere.define',
      name: 'Flappysky',
      tagline: 'Flutter past skeets and collect heart likes across the Atmosphere.',
      description:
        'An arcade browser game showcasing portable AT Protocol achievements, incremental milestones, and inline-signed leaderboards.',
      url: 'https://flappysky.symmetricalboy.com',
      category: 'browser',
      status: 'live',
      developer: {
        name: 'symmetricalboy',
        did: DYLAN_DID,
        url: 'https://symmetricalboy.com',
      },
      createdAt: daysAgo(10),
    },
  });

  const flappyAchievements = [
    {
      rkey: 'first-flight',
      icon: '/assets/icons/ach-first-flight.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: FLAPPY_GAME_URI,
        title: 'First Flight',
        description: 'Cleared your very first post in Flappysky.',
        requirement: 'Clear 1 post in a single run.',
        icon: DUMMY_BLOB(CID_1),
        iconAlt: 'Gold star badge on a sky-blue crest',
        tier: 'bronze',
        hidden: false,
        listOrder: 10,
        createdAt: daysAgo(10),
      },
    },
    {
      rkey: 'sky-ace',
      icon: '/assets/icons/ach-sky-ace.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: FLAPPY_GAME_URI,
        title: 'Sky Ace',
        description: 'Scored 50 or more points in a single Flappysky run.',
        requirement: 'Reach a score of 50 pts in one run.',
        icon: DUMMY_BLOB(CID_2),
        iconAlt: 'Golden crown emblem',
        tier: 'gold',
        hidden: false,
        listOrder: 20,
        createdAt: daysAgo(10),
      },
    },
    {
      rkey: 'banger-collector',
      icon: '/assets/icons/ach-banger-collector.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: FLAPPY_GAME_URI,
        title: 'Banger Collector',
        description: 'Collected 100 floating heart likes across all runs.',
        requirement: 'Collect 100 likes cumulatively.',
        icon: DUMMY_BLOB(CID_3),
        iconAlt: 'Glowing crimson heart badge',
        tier: 'silver',
        hidden: false,
        stepsNeeded: 100,
        listOrder: 30,
        createdAt: daysAgo(10),
      },
    },
    {
      rkey: 'atmosphere-legend',
      icon: '/assets/icons/ach-atmosphere-legend.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: FLAPPY_GAME_URI,
        title: 'Atmosphere Legend',
        description: 'Cleared 100 posts in a single fearless run through the timeline.',
        requirement: 'Clear 100 posts in a single run.',
        icon: DUMMY_BLOB(CID_4),
        iconAlt: 'Iridescent platinum hexagon diamond',
        tier: 'platinum',
        hidden: false,
        listOrder: 40,
        createdAt: daysAgo(10),
      },
    },
    {
      rkey: 'touch-grass',
      icon: '/assets/icons/ach-touch-grass.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: FLAPPY_GAME_URI,
        title: 'Touch Grass',
        description: 'Bonked straight into the ground without clearing a single post.',
        icon: DUMMY_BLOB(CID_3),
        iconAlt: 'Green blades of grass crest',
        tier: 'bronze',
        hidden: true,
        listOrder: 50,
        createdAt: daysAgo(10),
      },
    },
  ];

  for (const ach of flappyAchievements) {
    await indexer.indexRecord({
      uri: `at://${FLAPPY_DID}/${NSIDS.AchievementDefinition}/${ach.rkey}`,
      isDemo: true,
      iconUrlOverride: ach.icon,
      record: ach.record,
    });
  }

  const FLAPPY_LB_URI = `at://${FLAPPY_DID}/${NSIDS.LeaderboardDefinition}/high-score`;
  await indexer.indexRecord({
    uri: FLAPPY_LB_URI,
    isDemo: true,
    iconUrlOverride: '/assets/icons/lb-high-score.svg',
    record: {
      $type: NSIDS.LeaderboardDefinition,
      game: FLAPPY_GAME_URI,
      name: 'High Scores',
      description: 'Combined points from cleared posts and collected heart likes in a single run.',
      icon: DUMMY_BLOB(CID_4),
      iconAlt: 'Three-tier arcade podium',
      sortOrder: 'largerIsBetter',
      scoreFormat: {
        kind: 'numeric',
        decimalPlaces: 0,
        unitSingular: 'pt',
        unitPlural: 'pts',
      },
      timeframes: ['daily', 'weekly', 'allTime'],
      recordPolicy: 'perWindowBest',
      scoreMin: 1,
      scoreMax: 9999,
      listOrder: 1,
      createdAt: daysAgo(10),
    },
  });

  // 2. Game #2: Neon Drift 2086 (demonstrates 100% Completed Game showcase & smallerIsBetter speedrun clock!)
  const DRIFT_GAME_URI = `at://${DRIFT_DID}/games.atmosphere.define/neon-drift`;
  await indexer.indexRecord({
    uri: DRIFT_GAME_URI,
    isDemo: true,
    iconUrlOverride: '/assets/icons/game-neondrift.svg',
    record: {
      $type: 'games.atmosphere.define',
      name: 'Neon Drift 2086',
      tagline: 'Synthwave time-trial racer with millisecond speedrun leaderboards.',
      description:
        'Demonstrates `smallerIsBetter` millisecond time leaderboards and 100% game completion showcases on Open Gaming.',
      url: 'https://opengaming.games',
      category: 'browser',
      status: 'live',
      developer: {
        name: 'Open Gaming Lab',
        did: DRIFT_DID,
      },
      createdAt: daysAgo(14),
    },
  });

  const driftAchievements = [
    {
      rkey: 'sub-minute',
      icon: '/assets/icons/ach-sub-minute.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: DRIFT_GAME_URI,
        title: 'Sub-Minute Runner',
        description: 'Finished Neon Bay Circuit in under 60.00 seconds.',
        requirement: 'Finish Neon Bay Circuit under 1:00.00.',
        icon: DUMMY_BLOB(CID_1),
        iconAlt: 'Blue stopwatch emblem',
        tier: 'silver',
        hidden: false,
        listOrder: 10,
        createdAt: daysAgo(14),
      },
    },
    {
      rkey: 'drift-king',
      icon: '/assets/icons/ach-drift-king.svg',
      record: {
        $type: NSIDS.AchievementDefinition,
        game: DRIFT_GAME_URI,
        title: 'Apex Perfection',
        description: 'Completed every hairpin in Sector 7 without touching a barrier.',
        requirement: 'Clear Sector 7 with zero wall taps.',
        icon: DUMMY_BLOB(CID_2),
        iconAlt: 'Violet neon tire trail crest',
        tier: 'platinum',
        hidden: false,
        listOrder: 20,
        createdAt: daysAgo(14),
      },
    },
  ];

  for (const ach of driftAchievements) {
    await indexer.indexRecord({
      uri: `at://${DRIFT_DID}/${NSIDS.AchievementDefinition}/${ach.rkey}`,
      isDemo: true,
      iconUrlOverride: ach.icon,
      record: ach.record,
    });
  }

  const DRIFT_LB_URI = `at://${DRIFT_DID}/${NSIDS.LeaderboardDefinition}/neon-bay-time-trial`;
  await indexer.indexRecord({
    uri: DRIFT_LB_URI,
    isDemo: true,
    iconUrlOverride: '/assets/icons/lb-speedrun.svg',
    record: {
      $type: NSIDS.LeaderboardDefinition,
      game: DRIFT_GAME_URI,
      name: 'Neon Bay Time Trial',
      description: 'Fastest 3-lap completion time (smaller is better, measured in milliseconds).',
      icon: DUMMY_BLOB(CID_4),
      iconAlt: 'Speedometer stopwatch icon',
      sortOrder: 'smallerIsBetter',
      scoreFormat: {
        kind: 'time',
        timeUnit: 'milliseconds',
      },
      timeframes: ['weekly', 'allTime'],
      recordPolicy: 'bestOnly',
      scoreMin: 20_000,
      scoreMax: 600_000,
      listOrder: 1,
      createdAt: daysAgo(14),
    },
  });

  // Helper to sign & index unlocks
  const grantUnlock = async (
    issuerDid: string,
    signingKey: typeof flappyKeys.keypair,
    gameUri: string,
    achRkey: string,
    playerDid: string,
    unlockedAt: string
  ) => {
    const achUri = `at://${issuerDid}/${NSIDS.AchievementDefinition}/${achRkey}`;
    const { record } = await createSignedUnlock({
      achievement: achUri,
      game: gameUri,
      playerDid,
      issuerDid,
      unlockedAt,
      signingKey,
    });
    await indexer.indexRecord({
      uri: `at://${playerDid}/${NSIDS.AchievementUnlock}/${getUnlockRkey(achUri)}`,
      record,
      isDemo: true,
    });
  };

  // Dylan unlocks 100% of Neon Drift (2/2 -> Completed Game!) + 3/5 of Flappysky + 68/100 progress on Banger Collector!
  await grantUnlock(DRIFT_DID, driftKeys.keypair, DRIFT_GAME_URI, 'sub-minute', DYLAN_DID, daysAgo(3));
  await grantUnlock(DRIFT_DID, driftKeys.keypair, DRIFT_GAME_URI, 'drift-king', DYLAN_DID, daysAgo(2));

  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'first-flight', DYLAN_DID, isoAgo(180));
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'sky-ace', DYLAN_DID, isoAgo(45));
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'touch-grass', DYLAN_DID, isoAgo(35));

  const bangerUri = `at://${FLAPPY_DID}/${NSIDS.AchievementDefinition}/banger-collector`;
  const { record: dylanProg } = await createSignedProgress({
    achievement: bangerUri,
    game: FLAPPY_GAME_URI,
    currentSteps: 68,
    stepsNeeded: 100,
    playerDid: DYLAN_DID,
    issuerDid: FLAPPY_DID,
    updatedAt: isoAgo(15),
    signingKey: flappyKeys.keypair,
  });
  await indexer.indexRecord({
    uri: `at://${DYLAN_DID}/${NSIDS.AchievementProgress}/${getUnlockRkey(bangerUri)}`,
    record: dylanProg,
    isDemo: true,
  });

  // Friends unlocks
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'first-flight', TREZY_DID, daysAgo(4));
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'sky-ace', TREZY_DID, daysAgo(2));
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'banger-collector', TREZY_DID, isoAgo(90));
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'atmosphere-legend', TREZY_DID, isoAgo(60));

  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'first-flight', BOBA_DID, daysAgo(1));
  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'banger-collector', BOBA_DID, isoAgo(25));

  await grantUnlock(FLAPPY_DID, flappyKeys.keypair, FLAPPY_GAME_URI, 'first-flight', BAILEY_DID, daysAgo(5));
  await grantUnlock(DRIFT_DID, driftKeys.keypair, DRIFT_GAME_URI, 'sub-minute', BAILEY_DID, daysAgo(4));

  // Signed Leaderboard Scores across Daily / Weekly / All-Time windows
  const submitScore = async ({
    issuerDid,
    signingKey,
    lbUri,
    gameUri,
    playerDid,
    score,
    tag,
    recordedAt,
    rkey,
  }: {
    issuerDid: string;
    signingKey: typeof flappyKeys.keypair;
    lbUri: string;
    gameUri: string;
    playerDid: string;
    score: number;
    tag?: string;
    recordedAt: string;
    rkey: string;
  }) => {
    const { record, attestationCid } = await createSignedScore({
      leaderboard: lbUri,
      game: gameUri,
      playerDid,
      issuerDid,
      score,
      tag,
      recordedAt,
      signingKey,
    });
    const uri = `at://${playerDid}/${NSIDS.LeaderboardScore}/${rkey}`;
    await indexer.indexRecord({ uri, record, isDemo: true });
    return { uri, attestationCid };
  };

  // All-time high by Trezy (5 days ago), today's runs by Dylan, Boba, Trezy, and Bailey
  await submitScore({
    issuerDid: FLAPPY_DID,
    signingKey: flappyKeys.keypair,
    lbUri: FLAPPY_LB_URI,
    gameUri: FLAPPY_GAME_URI,
    playerDid: TREZY_DID,
    score: 148,
    tag: 'posts:112,likes:36',
    recordedAt: daysAgo(5),
    rkey: 'run-alltime-trezy',
  });
  await submitScore({
    issuerDid: FLAPPY_DID,
    signingKey: flappyKeys.keypair,
    lbUri: FLAPPY_LB_URI,
    gameUri: FLAPPY_GAME_URI,
    playerDid: DYLAN_DID,
    score: 94,
    tag: 'posts:72,likes:22',
    recordedAt: isoAgo(18),
    rkey: 'run-today-dylan',
  });
  await submitScore({
    issuerDid: FLAPPY_DID,
    signingKey: flappyKeys.keypair,
    lbUri: FLAPPY_LB_URI,
    gameUri: FLAPPY_GAME_URI,
    playerDid: BOBA_DID,
    score: 86,
    tag: 'posts:61,likes:25',
    recordedAt: isoAgo(32),
    rkey: 'run-today-boba',
  });
  await submitScore({
    issuerDid: FLAPPY_DID,
    signingKey: flappyKeys.keypair,
    lbUri: FLAPPY_LB_URI,
    gameUri: FLAPPY_GAME_URI,
    playerDid: TREZY_DID,
    score: 79,
    tag: 'posts:60,likes:19',
    recordedAt: isoAgo(50),
    rkey: 'run-today-trezy',
  });
  await submitScore({
    issuerDid: FLAPPY_DID,
    signingKey: flappyKeys.keypair,
    lbUri: FLAPPY_LB_URI,
    gameUri: FLAPPY_GAME_URI,
    playerDid: BAILEY_DID,
    score: 64,
    tag: 'posts:50,likes:14',
    recordedAt: daysAgo(2),
    rkey: 'run-week-bailey',
  });

  // Neon Drift speedrun times (smallerIsBetter, milliseconds!)
  await submitScore({
    issuerDid: DRIFT_DID,
    signingKey: driftKeys.keypair,
    lbUri: DRIFT_LB_URI,
    gameUri: DRIFT_GAME_URI,
    playerDid: DYLAN_DID,
    score: 52_480, // 0:52.48
    tag: 'car:interceptor',
    recordedAt: daysAgo(1),
    rkey: 'drift-pb-dylan',
  });
  await submitScore({
    issuerDid: DRIFT_DID,
    signingKey: driftKeys.keypair,
    lbUri: DRIFT_LB_URI,
    gameUri: DRIFT_GAME_URI,
    playerDid: BAILEY_DID,
    score: 56_910, // 0:56.91
    tag: 'car:specter',
    recordedAt: daysAgo(2),
    rkey: 'drift-pb-bailey',
  });

  // 3. Anti-Cheat & Revocation Showcase:
  // (A) Genuine signed score via pause-frame glitch -> revoked via `games.opengaming.revocation`!
  const exploited = await submitScore({
    issuerDid: FLAPPY_DID,
    signingKey: flappyKeys.keypair,
    lbUri: FLAPPY_LB_URI,
    gameUri: FLAPPY_GAME_URI,
    playerDid: CHEATER_DID,
    score: 9420,
    tag: 'posts:9400,likes:20',
    recordedAt: isoAgo(120),
    rkey: 'glitch-run-9420',
  });

  const { rkey: revRkey, record: revRecord } = createRevocationRecord({
    scope: 'attestation',
    attestationCid: exploited.attestationCid,
    player: CHEATER_DID,
    subject: FLAPPY_LB_URI,
    recordUri: exploited.uri,
    reason: 'exploit',
    note: 'Submitted via v1.0.0 pause-frame physics exploit; revoked on game PDS.',
    revokedAt: isoAgo(110),
  });
  await indexer.indexRecord({
    uri: `at://${FLAPPY_DID}/${NSIDS.Revocation}/${revRkey}`,
    record: revRecord,
    isDemo: true,
  });

  // (B) Self-written unsigned forgery in player's repo -> automatically rejected (`missing_signatures`)!
  await indexer.indexRecord({
    uri: `at://${CHEATER_DID}/${NSIDS.AchievementUnlock}/forged-legend`,
    isDemo: true,
    record: {
      $type: NSIDS.AchievementUnlock,
      achievement: `at://${FLAPPY_DID}/${NSIDS.AchievementDefinition}/atmosphere-legend`,
      game: FLAPPY_GAME_URI,
      player: CHEATER_DID,
      unlockedAt: isoAgo(95),
    },
  });
}
