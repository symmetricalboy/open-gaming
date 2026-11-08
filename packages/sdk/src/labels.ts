import {
  DEFAULT_INVALIDATING_LABELS,
  DEFAULT_VERIFICATION_LABELS,
} from './constants.js';
import type { AtprotoLabel } from './types.js';

/**
 * Fold chronological ATProto `com.atproto.label.defs#label` events into the currently active label set,
 * honoring `neg: true` negations (reinstatements) and `exp` expiration timestamps.
 */
export function resolveActiveLabels(events: AtprotoLabel[], now: Date = new Date()): AtprotoLabel[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.cts) - Date.parse(b.cts));
  const activeMap = new Map<string, AtprotoLabel>();

  for (const ev of sorted) {
    const key = `${ev.src}|${ev.uri}|${ev.cid ?? ''}|${ev.val}`;
    if (ev.neg) {
      activeMap.delete(key);
    } else {
      activeMap.set(key, ev);
    }
  }

  const nowMs = now.getTime();
  const active: AtprotoLabel[] = [];
  for (const label of activeMap.values()) {
    if (label.exp) {
      const expMs = Date.parse(label.exp);
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        continue;
      }
    }
    active.push(label);
  }
  return active;
}

function filterTrustedLabels({
  recordUri,
  recordCid,
  playerDid,
  activeLabels,
  trustedLabelerDids,
  allowedValues,
  includePlayerDidTargets = true,
}: {
  recordUri?: string;
  recordCid?: string;
  playerDid?: string;
  activeLabels: AtprotoLabel[];
  trustedLabelerDids?: string[];
  allowedValues?: ReadonlySet<string>;
  includePlayerDidTargets?: boolean;
}): AtprotoLabel[] {
  const trustedSet = trustedLabelerDids ? new Set(trustedLabelerDids) : null;

  return activeLabels.filter((lbl) => {
    if (lbl.neg) return false;
    if (trustedSet && !trustedSet.has(lbl.src)) return false;
    if (allowedValues && !allowedValues.has(lbl.val)) return false;

    if (recordUri && lbl.uri === recordUri) {
      if (lbl.cid && recordCid && lbl.cid !== recordCid) return false;
      return true;
    }

    if (includePlayerDidTargets && playerDid && lbl.uri === playerDid) {
      return true;
    }

    return false;
  });
}

/**
 * Find active anti-cheat / moderation labels (`!cheat`, `cheating`, `exploit`, `invalid-replay`, `revoked`)
 * from trusted labelers targeting either `recordUri` or `playerDid`.
 */
export function findInvalidatingLabels({
  recordUri,
  recordCid,
  playerDid,
  activeLabels,
  trustedLabelerDids,
  invalidatingValues = DEFAULT_INVALIDATING_LABELS,
}: {
  recordUri?: string;
  recordCid?: string;
  playerDid?: string;
  activeLabels: AtprotoLabel[];
  trustedLabelerDids?: string[];
  invalidatingValues?: readonly string[];
}): AtprotoLabel[] {
  return filterTrustedLabels({
    recordUri,
    recordCid,
    playerDid,
    activeLabels,
    trustedLabelerDids,
    allowedValues: new Set(invalidatingValues),
    includePlayerDidTargets: true,
  });
}

/**
 * Find active positive replay/community verification labels (`verified-replay`, `community-verified`)
 * on `recordUri`, supporting post-EoS serverless verification workflows.
 */
export function findVerificationLabels({
  recordUri,
  recordCid,
  activeLabels,
  trustedLabelerDids,
  verificationValues = DEFAULT_VERIFICATION_LABELS,
}: {
  recordUri?: string;
  recordCid?: string;
  activeLabels: AtprotoLabel[];
  trustedLabelerDids?: string[];
  verificationValues?: readonly string[];
}): AtprotoLabel[] {
  if (!recordUri) return [];
  return filterTrustedLabels({
    recordUri,
    recordCid,
    activeLabels,
    trustedLabelerDids,
    allowedValues: new Set(verificationValues),
    includePlayerDidTargets: false,
  });
}

/**
 * Return all deduplicated active label value strings (`val`) attached to `recordUri` or `playerDid`.
 */
export function getRecordLabelValues({
  recordUri,
  recordCid,
  playerDid,
  activeLabels,
  trustedLabelerDids,
}: {
  recordUri?: string;
  recordCid?: string;
  playerDid?: string;
  activeLabels: AtprotoLabel[];
  trustedLabelerDids?: string[];
}): string[] {
  const matched = filterTrustedLabels({
    recordUri,
    recordCid,
    playerDid,
    activeLabels,
    trustedLabelerDids,
    includePlayerDidTargets: true,
  });
  return [...new Set(matched.map((m) => m.val))];
}
