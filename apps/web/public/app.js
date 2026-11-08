const appRoot = document.getElementById('app-root');
const announcer = document.getElementById('status-announcer');
const proofDialog = document.getElementById('proof-dialog');
const proofDialogBody = document.getElementById('proof-dialog-body');
const syncDialog = document.getElementById('sync-dialog');
const syncForm = document.getElementById('sync-repo-form');
const syncInput = document.getElementById('sync-actor-input');
const syncSubmitBtn = document.getElementById('sync-submit-btn');
const syncResultBox = document.getElementById('sync-result-box');
const lookupForm = document.getElementById('player-lookup-form');
const lookupInput = document.getElementById('player-lookup-input');
const themeToggleBtn = document.getElementById('theme-toggle');
const openSyncBtn = document.getElementById('open-sync-btn');

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escCssString(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return dateFmt.format(d);
}

function shortCid(cid) {
  if (!cid) return '';
  return cid.length > 20 ? `${cid.slice(0, 11)}…${cid.slice(-6)}` : cid;
}

function announce(msg) {
  if (!announcer) return;
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = msg;
  }, 40);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || body.error || `HTTP ${res.status}`);
  }
  return body;
}

/* --- Modern Web Guidance: Two-state Dark Mode Toggle --- */
function applyColorSchemeMeta(storedValue) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = storedValue === 'light' || storedValue === 'dark' ? storedValue : 'light dark';
  }
}

themeToggleBtn?.addEventListener('click', () => {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const systemScheme = systemPrefersDark ? 'dark' : 'light';
  let stored = null;
  try {
    stored = localStorage.getItem('color-scheme');
  } catch {}

  const currentRendered = stored === 'light' || stored === 'dark' ? stored : systemScheme;
  const targetScheme = currentRendered === 'dark' ? 'light' : 'dark';

  if (targetScheme === systemScheme) {
    try {
      localStorage.removeItem('color-scheme');
    } catch {}
    applyColorSchemeMeta(null);
  } else {
    try {
      localStorage.setItem('color-scheme', targetScheme);
    } catch {}
    applyColorSchemeMeta(targetScheme);
  }
});

window.addEventListener('storage', (e) => {
  if (e.key === 'color-scheme') {
    applyColorSchemeMeta(e.newValue);
  }
});

/* --- Modern Web Guidance: Dialog Light-Dismiss Fallback & returnValue Reset --- */
for (const dlg of document.querySelectorAll('dialog[closedby="any"]')) {
  dlg.addEventListener('close', () => {
    dlg.returnValue = '';
  });

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dlg.addEventListener('click', (event) => {
      if (event.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isDialogContent) {
        dlg.close();
      }
    });
  }
}

openSyncBtn?.addEventListener('click', () => {
  syncResultBox.hidden = true;
  syncResultBox.innerHTML = '';
  syncDialog.showModal();
});

syncForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const actor = syncInput.value.trim();
  if (!actor) return;

  syncSubmitBtn.disabled = true;
  syncResultBox.hidden = false;
  syncResultBox.textContent = `Resolving ${actor} and scanning PDS collections…`;

  try {
    const out = await fetchJson('/api/sync-repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor }),
    });
    const breakdown = Object.entries(out.indexedCounts || {})
      .map(([col, n]) => `<li><code>${esc(col)}</code>: <strong>${Number(n)}</strong></li>`)
      .join('');

    syncResultBox.innerHTML = `
      <p><strong>Synced ${esc(out.handle || out.did)}</strong> from <code>${esc(out.pdsUrl)}</code></p>
      <p class="muted-text">Total Open Gaming / Atmosphere records indexed: <strong>${Number(out.totalIndexed)}</strong></p>
      ${breakdown ? `<ul role="list">${breakdown}</ul>` : '<p class="muted-text">No Open Gaming records published on this repository yet.</p>'}
      <p><a href="/player?actor=${encodeURIComponent(out.handle || out.did)}" data-nav="/player?actor=${encodeURIComponent(out.handle || out.did)}">Open Player Gamercard &rarr;</a></p>
    `;
    announce(`Synced ${out.totalIndexed} records for ${out.handle || out.did}.`);
  } catch (err) {
    syncResultBox.innerHTML = `<p><strong>Sync Error:</strong> ${esc(err.message)}</p>`;
    announce(`Sync failed: ${err.message}`);
  } finally {
    syncSubmitBtn.disabled = false;
  }
});

/* --- Cryptographic Proof Inspector Modal --- */
async function openProofInspector(recordUri) {
  proofDialogBody.innerHTML = '<p class="muted-text">Loading cryptographic attestation, labels &amp; revocation state…</p>';
  proofDialog.showModal();

  try {
    const data = await fetchJson(`/api/proof?uri=${encodeURIComponent(recordUri)}`);
    const isLabelVerified = Boolean(data.verified && String(data.keyId || '').startsWith('label:'));
    const statusBadge = data.labelInvalidated
      ? '<span class="proof-chip revoked">Invalidated by Anti-Cheat Label</span>'
      : data.revoked
        ? '<span class="proof-chip revoked">Revoked on Game PDS</span>'
        : isLabelVerified
          ? '<span class="proof-chip verified">Verified via Community Replay Label</span>'
          : data.verified
            ? '<span class="proof-chip verified">Verified Inline Signature</span>'
            : `<span class="proof-chip revoked">Rejected (${esc(data.verificationError || 'unverified')})</span>`;

    const rkeyBound = data.record?.signatures?.[0]?.rkey;

    const labelsSection =
      Array.isArray(data.activeLabels) && data.activeLabels.length > 0
        ? `
          <h3>Active ATProto Labels (<code>com.atproto.label.defs#label</code>)</h3>
          <dl class="kv-dl">
            ${data.activeLabels
              .map(
                (l) => `
                  <dt><code>${esc(l.val)}</code></dt>
                  <dd>Issued by <code>${esc(l.src)}</code> &middot; ${formatTime(l.cts)}</dd>
                `
              )
              .join('')}
          </dl>
        `
        : '';

    const revocationSection = data.revocation
      ? `
        <h3>Matching Publisher Revocation (<code>games.opengaming.revocation</code>)</h3>
        <dl class="kv-dl">
          <dt>Revocation URI</dt>
          <dd><code>${esc(data.revocationUri)}</code></dd>
          <dt>Scope &amp; Reason</dt>
          <dd><code>${esc(data.revocation.scope)}</code> &middot; <strong>${esc(data.revocation.reason)}</strong></dd>
          ${data.revocation.note ? `<dt>Publisher Note</dt><dd>${esc(data.revocation.note)}</dd>` : ''}
        </dl>
        <pre tabindex="0"><code>${esc(JSON.stringify(data.revocation, null, 2))}</code></pre>
      `
      : '';

    proofDialogBody.innerHTML = `
      <div class="pill-row mb-sm">
        ${statusBadge}
        <span class="badge">${esc(data.kind)}</span>
        ${data.version ? `<span class="badge badge-accent">Version: ${esc(data.version)}</span>` : ''}
      </div>
      ${data.verificationMessage ? `<p class="muted-text">${esc(data.verificationMessage)}</p>` : ''}
      <dl class="kv-dl">
        <dt>Record AT-URI</dt>
        <dd><code>${esc(data.uri)}</code></dd>
        <dt>Player Repo DID</dt>
        <dd><code>${esc(data.playerDid)}</code></dd>
        ${data.issuerDid ? `<dt>Signing / Verifying Issuer</dt><dd><code>${esc(data.issuerDid)}</code></dd>` : ''}
        <dt>Verification Key / Source</dt>
        <dd><code>${esc(data.keyId || 'None (Unsigned)')}</code></dd>
        <dt>Attestation CID</dt>
        <dd><code>${esc(data.attestationCid || 'N/A')}</code></dd>
        ${rkeyBound ? `<dt>Bound Record Key ($sig.rkey)</dt><dd><code>${esc(rkeyBound)}</code></dd>` : ''}
        ${data.replayCid ? `<dt>Replay Blob CID</dt><dd><code>${esc(data.replayCid)}</code></dd>` : ''}
      </dl>
      ${labelsSection}
      ${revocationSection}
      <h3>Raw Player PDS Record JSON</h3>
      <pre tabindex="0"><code>${esc(JSON.stringify(data.record, null, 2))}</code></pre>
    `;
  } catch (err) {
    proofDialogBody.innerHTML = `<p><strong>Error loading proof:</strong> ${esc(err.message)}</p>`;
  }
}

/* --- Tier Badge Helper --- */
function renderTierBadge(tier) {
  if (!tier) return '';
  const safe = String(tier).toLowerCase();
  return `<span class="badge tier-${esc(safe)}">${esc(tier)}</span>`;
}

/* --- View Renderers --- */
async function renderOverview() {
  document.title = 'Overview | opengaming.games';
  const data = await fetchJson('/api/overview');
  const jsDotClass = data.jetstream.connected ? 'status-dot' : 'status-dot offline';
  const jsLabel = data.jetstream.connected
    ? `Jetstream Live (${data.jetstream.eventsProcessed} events)`
    : 'Jetstream Standby · Local SQLite Ready';

  const gamesSectionBody = data.games.length
    ? `<ul class="cards-grid" role="list">${data.games
        .map(
          (g) => `
      <li class="card">
        <div class="card-row">
          <img src="${esc(g.iconUrl || '/assets/icons/locked.svg')}" alt="${esc(g.name)} icon" width="56" height="56" class="game-icon">
          <div>
            <div class="pill-row">
              <h3><a href="/game?uri=${encodeURIComponent(g.uri)}" data-nav="/game?uri=${encodeURIComponent(g.uri)}">${esc(g.name)}</a></h3>
              <span class="badge">Live ATProto</span>
            </div>
            <p class="muted-text">${esc(g.tagline || '')}</p>
          </div>
        </div>
        <div class="pill-row">
          <span class="badge">${Number(g.achievementCount)} Achievements</span>
          <span class="badge">${Number(g.leaderboardCount)} Leaderboards</span>
          <span class="badge">${Number(g.playerCount)} Verified Players</span>
        </div>
        <div class="pill-row">
          <a href="/game?uri=${encodeURIComponent(g.uri)}" data-nav="/game?uri=${encodeURIComponent(g.uri)}" class="btn btn-subtle">Explore Achievements</a>
          ${
            g.primaryLeaderboardUri
              ? `<a href="/leaderboards?leaderboard=${encodeURIComponent(g.primaryLeaderboardUri)}" data-nav="/leaderboards?leaderboard=${encodeURIComponent(g.primaryLeaderboardUri)}" class="btn">Leaderboard</a>`
              : ''
          }
          ${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener" class="btn">Play &nearr;</a>` : ''}
        </div>
      </li>
    `
        )
        .join('')}</ul>`
    : '<p class="card muted-text">No games indexed yet. Click <strong>Sync PDS</strong> to index a live ATProto game repository.</p>';

  const actorsRowHtml = data.featuredActors.length
    ? `<div class="pill-row">
         <span class="muted-text">Explore Gamercards:</span>
         ${data.featuredActors
           .map(
             (a) => `
             <a href="/player?actor=${encodeURIComponent(a.handle || a.did)}" data-nav="/player?actor=${encodeURIComponent(a.handle || a.did)}" class="btn btn-subtle">
               @${esc(a.handle || a.displayName)} &middot; ${Number(a.unlocks)} Trophies
             </a>
           `
           )
           .join('')}
       </div>`
    : '';

  const unlocksBody = data.recentUnlocks.length
    ? `<ul class="feed-list" role="list">${data.recentUnlocks
        .map(
          (u) => `
      <li class="feed-item">
        <div class="card-row">
          <img src="${esc(u.iconUrl || '/assets/icons/locked.svg')}" alt="${esc(u.iconAlt)}" width="42" height="42" class="ach-icon" loading="lazy">
          <div>
            <div>
              <strong><a href="/player?actor=${encodeURIComponent(u.handle || u.playerDid)}" data-nav="/player?actor=${encodeURIComponent(u.handle || u.playerDid)}">@${esc(u.handle || u.displayName)}</a></strong>
              unlocked <strong>${esc(u.achievementTitle)}</strong>
              ${renderTierBadge(u.tier)}
            </div>
            <div class="muted-text">
              in <a href="/game?uri=${encodeURIComponent(u.gameUri || '')}" data-nav="/game?uri=${encodeURIComponent(u.gameUri || '')}">${esc(u.gameName)}</a>
              &middot; ${formatTime(u.unlockedAt)}
            </div>
          </div>
        </div>
        <button type="button" class="proof-chip verified" data-proof-uri="${esc(u.uri)}" aria-label="Inspect cryptographic proof for ${esc(u.achievementTitle)}">
          Verified &middot; ${esc(shortCid(u.attestationCid))}
        </button>
      </li>
    `
        )
        .join('')}</ul>`
    : '<p class="muted-text">No verified achievements unlocked yet — launch a game and connect your ATProto account to earn the first trophy.</p>';

  const scoresBody = data.recentScores.length
    ? `<ul class="feed-list" role="list">${data.recentScores
        .map(
          (s) => `
      <li class="feed-item">
        <div>
          <div>
            <strong><a href="/player?actor=${encodeURIComponent(s.handle || s.playerDid)}" data-nav="/player?actor=${encodeURIComponent(s.handle || s.playerDid)}">@${esc(s.handle || s.displayName)}</a></strong>
            posted <span class="score-mono">${esc(s.displayScore)}</span>
          </div>
          <div class="muted-text">
            <a href="/leaderboards?leaderboard=${encodeURIComponent(s.leaderboardUri)}" data-nav="/leaderboards?leaderboard=${encodeURIComponent(s.leaderboardUri)}">${esc(s.gameName)} — ${esc(s.leaderboardName)}</a>
            &middot; ${formatTime(s.recordedAt)}
          </div>
        </div>
        <button type="button" class="proof-chip verified" data-proof-uri="${esc(s.uri)}" aria-label="Inspect cryptographic proof for ${esc(s.displayScore)} score">
          Verified
        </button>
      </li>
    `
        )
        .join('')}</ul>`
    : '<p class="muted-text">No verified leaderboard scores recorded yet.</p>';

  return `
    <section class="hero-banner">
      <div class="hero-top">
        <div>
          <h1 id="view-heading" tabindex="-1">Portable Achievements &amp; Leaderboards on AT Protocol</h1>
          <p class="muted-text">
            Per-game appreciation without global gamerscore inflation. Canonical definitions live on each game's PDS; players hold inline ECDSA-signed receipts in their own repositories.
          </p>
        </div>
        <span class="status-pill">
          <span class="${jsDotClass}" aria-hidden="true"></span>
          ${esc(jsLabel)}
        </span>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${Number(data.stats.gamesCount)}</div>
          <div class="stat-label">Indexed Games</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(data.stats.achievementDefinitionsCount)}</div>
          <div class="stat-label">Achievement Definitions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(data.stats.verifiedUnlocksCount)}</div>
          <div class="stat-label">Verified Unlocks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(data.stats.verifiedScoresCount)}</div>
          <div class="stat-label">Verified Scores</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(data.stats.blockedAttemptsCount)}</div>
          <div class="stat-label">Blocked / Revoked Exploits</div>
        </div>
      </div>

      ${actorsRowHtml}
    </section>

    <section class="section-block">
      <div class="section-header">
        <h2>Games Catalog</h2>
        <a href="/games" data-nav="/games">View all games &rarr;</a>
      </div>
      ${gamesSectionBody}
    </section>

    <div class="two-col-grid">
      <section class="card">
        <div class="section-header">
          <h2>Recent Verified Unlocks</h2>
        </div>
        ${unlocksBody}
      </section>

      <section class="card">
        <div class="section-header">
          <h2>Recent High Scores</h2>
          <a href="/leaderboards" data-nav="/leaderboards">Full leaderboards &rarr;</a>
        </div>
        ${scoresBody}
      </section>
    </div>
  `;
}

async function renderGamesCatalog() {
  document.title = 'Games Catalog | opengaming.games';
  const { games } = await fetchJson('/api/games');

  const catalogBody = games.length
    ? `<ul class="cards-grid" role="list">${games
        .map(
          (g) => `
      <li class="card">
        <div class="card-row">
          <img src="${esc(g.iconUrl || '/assets/icons/locked.svg')}" alt="${esc(g.name)} icon" width="60" height="60" class="game-icon">
          <div>
            <h2><a href="/game?uri=${encodeURIComponent(g.uri)}" data-nav="/game?uri=${encodeURIComponent(g.uri)}">${esc(g.name)}</a></h2>
            <p class="muted-text">${esc(g.tagline || g.description || '')}</p>
          </div>
        </div>
        <div class="pill-row">
          <span class="badge">${Number(g.achievementCount)} Achievements (Uncapped)</span>
          <span class="badge">${Number(g.leaderboardCount)} Leaderboards</span>
          <span class="badge">${Number(g.playerCount)} Verified Players</span>
          ${g.developerName ? `<span class="badge">By ${esc(g.developerName)}</span>` : ''}
        </div>
        <div class="pill-row">
          <a href="/game?uri=${encodeURIComponent(g.uri)}" data-nav="/game?uri=${encodeURIComponent(g.uri)}" class="btn btn-primary">Open Game Hub</a>
          ${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener" class="btn">Launch Game &nearr;</a>` : ''}
        </div>
      </li>
    `
        )
        .join('')}</ul>`
    : '<p class="card muted-text">No games indexed yet. Click <strong>Sync PDS</strong> to index a live ATProto game repository.</p>';

  return `
    <div class="section-header">
      <div>
        <h1 id="view-heading" tabindex="-1">Games Catalog</h1>
        <p class="muted-text">Games publishing <code>games.atmosphere.define</code> alongside <code>games.opengaming.*</code> achievements and leaderboards.</p>
      </div>
    </div>
    ${catalogBody}
  `;
}

async function renderGameDetail(searchParams) {
  const uri = searchParams.get('uri') || '';
  const viewer = searchParams.get('viewer') || '';
  const revealSpoilers = searchParams.get('spoilers') === '1';

  const data = await fetchJson(
    `/api/game?uri=${encodeURIComponent(uri)}${viewer ? `&viewer=${encodeURIComponent(viewer)}` : ''}`
  );
  document.title = `${data.game.name} | opengaming.games`;

  const toggleSpoilerUrl = `/game?uri=${encodeURIComponent(uri)}${viewer ? `&viewer=${encodeURIComponent(viewer)}` : ''}${
    revealSpoilers ? '' : '&spoilers=1'
  }`;

  const achCards = data.achievements
    .map((a) => {
      const unlocked = Boolean(a.viewerUnlock);
      const showMasked = a.masked && !revealSpoilers;
      const displayTitle = showMasked ? 'Hidden Achievement' : a.revealedTitle;
      const displayDesc = showMasked
        ? a.hiddenSpace
          ? 'Spoiler-proof hidden stub — unlock in-game to receive access to the ATProto Space holding the real metadata.'
          : 'Unlock this achievement in-game (or click Reveal Spoilers) to view details.'
        : unlocked
          ? a.revealedDescription
          : a.requirement || a.revealedDescription;
      const iconSrc = showMasked ? '/assets/icons/locked.svg' : a.iconUrl || '/assets/icons/locked.svg';

      const progressBlock =
        !unlocked && a.stepsNeeded
          ? `
          <div class="progress-wrap">
            <div class="progress-meta">
              <span>Incremental Milestone</span>
              <span>${Number(a.viewerProgress?.currentSteps ?? 0)} / ${Number(a.stepsNeeded)} steps</span>
            </div>
            <progress value="${Number(a.viewerProgress?.currentSteps ?? 0)}" max="${Number(a.stepsNeeded)}" aria-label="${esc(displayTitle)} step progress"></progress>
          </div>
        `
          : '';

      return `
        <li class="card ach-card ${unlocked || !viewer ? '' : 'locked'}">
          <div class="card-row">
            <img src="${esc(iconSrc)}" alt="${esc(a.iconAlt)}" width="56" height="56" class="ach-icon" loading="lazy">
            <div class="flex-1">
              <div class="pill-row">
                <h3>${esc(displayTitle)}</h3>
                ${renderTierBadge(a.tier)}
                ${a.hidden ? '<span class="badge">Hidden</span>' : ''}
                ${a.isRedactedStub || a.hiddenSpace ? '<span class="badge badge-accent">Space-Gated Stub</span>' : ''}
              </div>
              <p class="muted-text">${esc(displayDesc)}</p>
              ${a.hiddenSpace ? `<div class="muted-text">Space: <code>${esc(a.hiddenSpace)}</code></div>` : ''}
            </div>
          </div>
          ${progressBlock}
          <div class="pill-row card-footer-row">
            <span class="muted-text">${esc(a.rarityPercent)}% of players unlocked (${Number(a.unlockedPlayersCount)}/${Number(data.game.totalPlayers)})</span>
            ${
              a.viewerUnlock
                ? `<button type="button" class="proof-chip verified" data-proof-uri="${esc(a.viewerUnlock.uri)}">Unlocked &middot; Proof</button>`
                : ''
            }
          </div>
        </li>
      `;
    })
    .join('');

  const lbsHtml = data.leaderboards
    .map(
      (lb) => `
      <div class="card">
        <div class="section-header">
          <div>
            <h3>${esc(lb.definition.name)}</h3>
            <p class="muted-text">${esc(lb.definition.description || '')}</p>
          </div>
          <a href="/leaderboards?leaderboard=${encodeURIComponent(lb.definition.uri)}" data-nav="/leaderboards?leaderboard=${encodeURIComponent(lb.definition.uri)}" class="btn btn-primary">
            Open Full Board &rarr;
          </a>
        </div>
        ${
          lb.entries.length
            ? `<ol class="feed-list">
                ${lb.entries
                  .slice(0, 5)
                  .map(
                    (e) => `
                    <li class="feed-item">
                      <span><strong>#${Number(e.rank)}</strong> <a href="/player?actor=${encodeURIComponent(e.handle || e.player)}" data-nav="/player?actor=${encodeURIComponent(e.handle || e.player)}">@${esc(e.handle || e.displayName)}</a></span>
                      <span class="score-mono">${esc(e.displayScore)}</span>
                    </li>
                  `
                  )
                  .join('')}
              </ol>`
            : '<p class="muted-text">No verified scores recorded yet.</p>'
        }
      </div>
    `
    )
    .join('');

  return `
    <section class="hero-banner">
      <div class="card-row">
        <img src="${esc(data.game.iconUrl || '/assets/icons/locked.svg')}" alt="${esc(data.game.name)} icon" width="72" height="72" class="game-icon">
        <div style="flex: 1;">
          <div class="pill-row">
            <h1 id="view-heading" tabindex="-1">${esc(data.game.name)}</h1>
            <span class="badge">Live ATProto</span>
          </div>
          <p class="muted-text">${esc(data.game.description || data.game.tagline || '')}</p>
          <div class="pill-row">
            <span class="badge">${Number(data.achievements.length)} Achievements</span>
            <span class="badge">${Number(data.leaderboards.length)} Leaderboards</span>
            <span class="badge">Publisher: <code>${esc(data.game.publisherDid)}</code></span>
            ${data.game.url ? `<a href="${esc(data.game.url)}" target="_blank" rel="noopener" class="btn btn-primary">Play ${esc(data.game.name)} &nearr;</a>` : ''}
          </div>
        </div>
      </div>

      <div class="filter-bar" style="margin-block-end: 0;">
        <form id="game-viewer-filter-form" class="pill-row" data-game-uri="${esc(uri)}">
          <label for="game-viewer-input" class="muted-text">Compare against player:</label>
          <input type="text" id="game-viewer-input" name="viewer" value="${esc(viewer)}" placeholder="symmetricalboy.com">
          <button type="submit" class="btn btn-subtle">Compare</button>
          ${
            viewer
              ? `<a href="/game?uri=${encodeURIComponent(uri)}" data-nav="/game?uri=${encodeURIComponent(uri)}" class="btn">Clear</a>`
              : ''
          }
        </form>
        <a href="${esc(toggleSpoilerUrl)}" data-nav="${esc(toggleSpoilerUrl)}" class="btn btn-subtle">
          ${revealSpoilers ? 'Mask Hidden Spoilers' : 'Reveal Hidden Spoilers'}
        </a>
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <h2>Achievements (${Number(data.achievements.length)})</h2>
        <span class="muted-text">Ordered by publisher <code>listOrder</code> &middot; Global rarity across verified players</span>
      </div>
      <ul class="cards-grid" role="list">${achCards}</ul>
    </section>

    <section class="section-block">
      <div class="section-header">
        <h2>Leaderboards</h2>
      </div>
      <div class="two-col-grid">${lbsHtml}</div>
    </section>
  `;
}

async function renderLeaderboards(searchParams) {
  const { leaderboards } = await fetchJson('/api/leaderboards');
  if (!leaderboards.length) {
    document.title = 'Leaderboards | opengaming.games';
    return '<h1 id="view-heading" tabindex="-1">Leaderboards</h1><p class="muted-text">No leaderboards indexed yet.</p>';
  }

  const selectedUri = searchParams.get('leaderboard') || leaderboards[0].uri;
  const timeframe = searchParams.get('timeframe') || 'allTime';
  const scope = searchParams.get('scope') || 'public';
  const viewer = searchParams.get('viewer') || (scope === 'social' ? 'symmetricalboy.com' : '');
  const sortBy = searchParams.get('sortBy') || '';
  const version = searchParams.get('version') || '';

  const queryParams = new URLSearchParams({
    leaderboard: selectedUri,
    timeframe,
    scope,
  });
  if (viewer) queryParams.set('viewer', viewer);
  if (sortBy) queryParams.set('sortBy', sortBy);
  if (version) queryParams.set('version', version);

  const board = await fetchJson(`/api/leaderboard?${queryParams.toString()}`);
  document.title = `${board.definition.name} Leaderboard | opengaming.games`;

  const xrpcUrl = `/xrpc/games.opengaming.leaderboard.getScores?${queryParams.toString()}`;

  const selectorOptions = leaderboards
    .map(
      (lb) =>
        `<option value="${esc(lb.uri)}" ${lb.uri === selectedUri ? 'selected' : ''}>${esc(lb.gameName)} — ${esc(lb.name)}</option>`
    )
    .join('');

  const tfLabels = { allTime: 'All-Time', weekly: 'Weekly', daily: 'Daily' };
  const tfButtons = board.definition.timeframes
    .map((tf) => {
      const next = new URLSearchParams(queryParams);
      next.set('timeframe', tf);
      const active = tf === timeframe;
      return `<button type="button" data-nav="/leaderboards?${esc(next.toString())}" aria-pressed="${active}">${esc(
        tfLabels[tf] || tf
      )}</button>`;
    })
    .join('');

  const publicParams = new URLSearchParams(queryParams);
  publicParams.set('scope', 'public');
  const socialParams = new URLSearchParams(queryParams);
  socialParams.set('scope', 'social');
  if (!socialParams.get('viewer')) socialParams.set('viewer', 'symmetricalboy.com');

  const compMap =
    board.definition.components &&
    typeof board.definition.components === 'object' &&
    !Array.isArray(board.definition.components)
      ? board.definition.components
      : {};
  const orderedCompIds =
    Array.isArray(board.definition.componentOrder) && board.definition.componentOrder.length > 0
      ? board.definition.componentOrder.filter((id) => compMap[id])
      : Object.keys(compMap);
  const compDefs = orderedCompIds.map((id) => ({ id, ...compMap[id] }));
  const hasComponents = compDefs.length > 0;
  const sortableComps = compDefs.filter((c) => c.$type !== 'games.opengaming.defs#textComponentDef');
  const activeSortId = board.sortedBy || board.definition.defaultComponent || sortableComps[0]?.id || '';

  const componentSortBar =
    sortableComps.length > 1
      ? `
        <div class="pill-row">
          <span class="muted-text">Rank by Component:</span>
          <div class="segmented" role="group" aria-label="Sort by score component">
            ${sortableComps
              .map((c) => {
                const next = new URLSearchParams(queryParams);
                next.set('sortBy', c.id);
                const isSorted = c.id === activeSortId;
                return `<button type="button" data-nav="/leaderboards?${esc(next.toString())}" aria-pressed="${isSorted}">${esc(c.name)}</button>`;
              })
              .join('')}
          </div>
        </div>
      `
      : '';

  const rankedVersions = Array.isArray(board.definition.rankedVersions) ? board.definition.rankedVersions : [];
  const versionFilterBar =
    rankedVersions.length > 0
      ? `
        <div class="pill-row mb-sm">
          <span class="muted-text">Legal Chart / Build Hashes (<code>rankedVersions</code>):</span>
          ${(() => {
            const allParams = new URLSearchParams(queryParams);
            allParams.delete('version');
            const buttons = [
              `<button type="button" class="btn ${!version ? 'btn-primary' : 'btn-subtle'}" data-nav="/leaderboards?${esc(allParams.toString())}" aria-pressed="${!version}">All Legal (${rankedVersions.length})</button>`,
              ...rankedVersions.map((v) => {
                const vp = new URLSearchParams(queryParams);
                vp.set('version', v);
                const isSelected = version === v;
                const shortV = v.length > 22 ? `${v.slice(0, 18)}…` : v;
                return `<button type="button" class="btn ${isSelected ? 'btn-primary' : 'btn-subtle'}" data-nav="/leaderboards?${esc(vp.toString())}" aria-pressed="${isSelected}"><code>${esc(shortV)}</code></button>`;
              }),
            ];
            return buttons.join('');
          })()}
        </div>
      `
      : '';

  const scoreHeaders = hasComponents
    ? compDefs.map((c) => ({ id: c.id, label: c.name, active: c.id === activeSortId }))
    : [{ id: 'score', label: 'Score', active: false }];

  const colLabelsForMobile = [
    'Player',
    ...scoreHeaders.map((h) => h.label),
    'Run Tag',
    'Recorded',
    'Attestation',
  ];
  const tableCustomProps = colLabelsForMobile
    .map((lbl, idx) => `--label-${idx + 2}: "${escCssString(lbl)}"`)
    .join('; ');

  const totalDataCols = colLabelsForMobile.length;

  const rowsHtml = board.entries.length
    ? board.entries
        .map((e) => {
          const isViewer = board.viewerEntry && e.player === board.viewerEntry.player;
          const scoreCellsHtml = hasComponents
            ? (e.formattedComponents || [])
                .map(
                  (fc) =>
                    `<td class="${fc.id === activeSortId ? 'active-sort-col' : ''}"><span class="score-mono">${esc(fc.displayValue)}</span></td>`
                )
                .join('')
            : `<td><span class="score-mono">${esc(e.displayScore)}</span></td>`;

          const metaChips = [
            e.tag ? `<code>${esc(e.tag)}</code>` : '',
            e.version ? `<span class="badge">${esc(e.version.length > 18 ? `${e.version.slice(0, 15)}…` : e.version)}</span>` : '',
            e.hasReplay && e.replayDownloadUrl
              ? `<a href="${esc(e.replayDownloadUrl)}" target="_blank" rel="noopener" class="badge badge-accent">Replay &darr;</a>`
              : e.hasReplay
                ? '<span class="badge badge-accent">Replay</span>'
                : '',
            ...(Array.isArray(e.labels) ? e.labels.map((lbl) => `<span class="badge badge-accent">${esc(lbl)}</span>`) : []),
          ]
            .filter(Boolean)
            .join(' ');

          const proofLabel =
            e.verificationMethod === 'community-label'
              ? 'Community Verified'
              : `Verified &middot; ${esc(shortCid(e.attestationCid))}`;

          return `
            <tr class="${isViewer ? 'viewer-highlight' : ''}">
              <th scope="row">#${Number(e.rank)}</th>
              <td>
                <a href="/player?actor=${encodeURIComponent(e.handle || e.player)}" data-nav="/player?actor=${encodeURIComponent(e.handle || e.player)}">
                  <strong>@${esc(e.handle || e.displayName)}</strong>
                </a>
                <div class="muted-text"><code>${esc(e.player)}</code></div>
              </td>
              ${scoreCellsHtml}
              <td>${metaChips ? `<div class="pill-row">${metaChips}</div>` : '<span class="muted-text">—</span>'}</td>
              <td>${formatTime(e.recordedAt)}</td>
              <td>
                <button type="button" class="proof-chip verified" data-proof-uri="${esc(e.uri)}" aria-label="Inspect cryptographic signature for rank ${Number(e.rank)}">
                  ${proofLabel}
                </button>
              </td>
            </tr>
          `;
        })
        .join('')
    : `<tr><th scope="row">—</th><td colspan="${totalDataCols}" class="muted-text">No verified scores recorded inside this ${esc(timeframe)} window yet.</td></tr>`;

  return `
    <div class="section-header">
      <div>
        <h1 id="view-heading" tabindex="-1">${esc(board.game?.name || 'Game')} — ${esc(board.definition.name)}</h1>
        <p class="muted-text">
          ${esc(board.definition.description || '')} &middot;
          Policy: <code>${esc(board.definition.recordPolicy)}</code> &middot;
          ${hasComponents ? `Sorted by: <code>${esc(activeSortId)}</code>` : `Order: <code>${esc(board.definition.sortOrder)}</code>`}
          ${board.definition.trustedIssuers?.length ? ` &middot; Federated Issuers: <strong>+${Number(board.definition.trustedIssuers.length)}</strong>` : ''}
        </p>
      </div>
      ${
        board.game
          ? `<a href="/game?uri=${encodeURIComponent(board.game.uri)}" data-nav="/game?uri=${encodeURIComponent(board.game.uri)}" class="btn btn-subtle">Game Hub &rarr;</a>`
          : ''
      }
    </div>

    <div class="filter-bar">
      <div class="pill-row">
        <label for="leaderboard-select" class="visually-hidden">Select Leaderboard</label>
        <select id="leaderboard-select">${selectorOptions}</select>

        <div class="segmented" role="group" aria-label="Timeframe">
          ${tfButtons}
        </div>

        <div class="segmented" role="group" aria-label="Leaderboard Scope">
          <button type="button" data-nav="/leaderboards?${esc(publicParams.toString())}" aria-pressed="${scope === 'public'}">Global</button>
          <button type="button" data-nav="/leaderboards?${esc(socialParams.toString())}" aria-pressed="${scope === 'social'}">Following (Social)</button>
        </div>
      </div>

      ${componentSortBar}

      <form id="lb-viewer-form" class="pill-row" data-lb-uri="${esc(selectedUri)}" data-timeframe="${esc(timeframe)}" data-scope="${esc(scope)}" data-sort-by="${esc(sortBy)}" data-version="${esc(version)}">
        <label for="lb-viewer-input" class="muted-text">Social Viewer:</label>
        <input type="text" id="lb-viewer-input" name="viewer" value="${esc(viewer)}" placeholder="symmetricalboy.com">
        <button type="submit" class="btn btn-subtle">Apply</button>
      </form>
    </div>

    ${versionFilterBar}

    <div class="xrpc-bar">
      <span>Live XRPC Query: <code>${esc(xrpcUrl)}</code></span>
      <a href="${esc(xrpcUrl)}" target="_blank" rel="noopener" class="btn btn-subtle">Raw JSON &nearr;</a>
    </div>

    ${
      board.viewerEntry
        ? `<p class="status-pill mb-sm">
             Viewer Standing (@${esc(board.viewerEntry.handle || board.viewerEntry.player)}):
             <strong>#${Number(board.viewerEntry.rank)}</strong> with <span class="score-mono">${esc(board.viewerEntry.displayScore)}</span>
           </p>`
        : ''
    }

    <div tabindex="0" role="region" aria-labelledby="leaderboard-caption" class="table-wrapper">
      <table style="${esc(tableCustomProps)}">
        <caption id="leaderboard-caption">
          ${esc(board.definition.name)} (${esc(tfLabels[timeframe] || timeframe)} &middot; ${scope === 'social' ? `Following of @${esc(viewer)}` : 'Global Verified Rankings'})
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            ${scoreHeaders
              .map(
                (h) =>
                  `<th scope="col" class="${h.active ? 'active-sort-col' : ''}">${esc(h.label)}</th>`
              )
              .join('')}
            <th scope="col">Run Tag</th>
            <th scope="col">Recorded</th>
            <th scope="col">Attestation</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

async function renderPlayerGamercard(searchParams) {
  const actorParam = searchParams.get('actor') || 'symmetricalboy.com';
  const data = await fetchJson(`/api/actor?actor=${encodeURIComponent(actorParam)}`);
  const { actor, profile, games, leaderboardStandings } = data;
  document.title = `@${actor.handle || actor.displayName} Gamercard | opengaming.games`;

  const xrpcUrl = `/xrpc/games.opengaming.actor.getProfile?actor=${encodeURIComponent(actor.handle || actor.did)}`;

  const gamesHtml = games.length
    ? games
        .map(
          (g) => `
          <section class="card">
            <div class="card-row" style="justify-content: space-between; flex-wrap: wrap;">
              <div class="card-row">
                <img src="${esc(g.iconUrl || '/assets/icons/locked.svg')}" alt="${esc(g.gameName)} icon" width="54" height="54" class="game-icon">
                <div>
                  <div class="pill-row">
                    <h3><a href="/game?uri=${encodeURIComponent(g.game)}&viewer=${encodeURIComponent(actor.handle || actor.did)}" data-nav="/game?uri=${encodeURIComponent(g.game)}&viewer=${encodeURIComponent(actor.handle || actor.did)}">${esc(g.gameName)}</a></h3>
                    ${g.completed ? '<span class="badge tier-platinum">100% Completed</span>' : ''}
                  </div>
                  <p class="muted-text">${esc(g.tagline || '')}</p>
                </div>
              </div>
              <div style="min-inline-size: 13rem;">
                <div class="progress-wrap">
                  <div class="progress-meta">
                    <span><strong>${Number(g.unlockedCount)} / ${Number(g.totalAchievements)}</strong> Achievements</span>
                    <span><strong>${Number(g.completionPercent)}%</strong></span>
                  </div>
                  <progress value="${Number(g.unlockedCount)}" max="${Math.max(1, Number(g.totalAchievements))}" aria-label="${esc(g.gameName)} completion"></progress>
                </div>
              </div>
            </div>

            <ul class="cards-grid" role="list">
              ${g.unlockedBadges
                .map(
                  (b) => `
                  <li class="card" style="background: var(--surface-elevated); padding: 0.85rem;">
                    <div class="card-row">
                      <img src="${esc(b.iconUrl || '/assets/icons/locked.svg')}" alt="${esc(b.iconAlt)}" width="44" height="44" class="ach-icon" loading="lazy">
                      <div style="flex: 1;">
                        <div class="pill-row">
                          <strong>${esc(b.title)}</strong>
                          ${renderTierBadge(b.tier)}
                        </div>
                        <p class="muted-text" style="margin-block-end: 0.35rem;">${esc(b.description)}</p>
                        <div class="pill-row" style="justify-content: space-between;">
                          <span class="muted-text">${formatTime(b.unlockedAt)}</span>
                          <button type="button" class="proof-chip verified" data-proof-uri="${esc(b.unlockUri)}">Proof</button>
                        </div>
                      </div>
                    </div>
                  </li>
                `
                )
                .join('')}
            </ul>

            ${
              g.inProgress.length
                ? `
                  <div>
                    <h4 style="margin-block: 0.25rem 0.5rem; font-size: 0.9rem;">Incremental Milestones In Progress</h4>
                    <div class="two-col-grid">
                      ${g.inProgress
                        .map(
                          (p) => `
                          <div class="stat-card">
                            <div class="progress-meta">
                              <strong>${esc(p.title)}</strong>
                              <span>${Number(p.currentSteps)} / ${Number(p.stepsNeeded)}</span>
                            </div>
                            <p class="muted-text" style="margin-block: 0.2rem 0.4rem;">${esc(p.requirement)}</p>
                            <progress value="${Number(p.currentSteps)}" max="${Number(p.stepsNeeded)}" aria-label="${esc(p.title)} progress"></progress>
                          </div>
                        `
                        )
                        .join('')}
                    </div>
                  </div>
                `
                : ''
            }
          </section>
        `
        )
        .join('')
    : '<p class="card muted-text">No verified achievements unlocked yet for this ATProto account. Click <strong>Sync PDS</strong> to pull records from their live PDS!</p>';

  const standingsHtml = leaderboardStandings.length
    ? `
      <section class="section-block">
        <h2>Personal Best Leaderboard Standings</h2>
        <ul class="cards-grid" role="list">
          ${leaderboardStandings
            .map(
              (s) => `
              <li class="card">
                <div class="pill-row" style="justify-content: space-between;">
                  <div>
                    <div class="muted-text">${esc(s.gameName)}</div>
                    <strong><a href="/leaderboards?leaderboard=${encodeURIComponent(s.leaderboardUri)}&viewer=${encodeURIComponent(actor.handle || actor.did)}" data-nav="/leaderboards?leaderboard=${encodeURIComponent(s.leaderboardUri)}&viewer=${encodeURIComponent(actor.handle || actor.did)}">${esc(s.leaderboardName)}</a></strong>
                  </div>
                  <span class="badge tier-gold">Rank #${Number(s.entry.rank)}</span>
                </div>
                <div class="pill-row" style="justify-content: space-between;">
                  <span class="score-mono">${esc(s.entry.displayScore)}</span>
                  <button type="button" class="proof-chip verified" data-proof-uri="${esc(s.entry.uri)}">Verified Proof</button>
                </div>
              </li>
            `
            )
            .join('')}
        </ul>
      </section>
    `
    : '';

  return `
    <section class="hero-banner">
      <div class="hero-top">
        <div>
          <h1 id="view-heading" tabindex="-1">@${esc(actor.handle || actor.displayName)}</h1>
          <p class="muted-text"><code>${esc(actor.did)}</code> &middot; Per-Game Trophy Showcase (XP-Free)</p>
        </div>
        <a href="/leaderboards?scope=social&viewer=${encodeURIComponent(actor.handle || actor.did)}" data-nav="/leaderboards?scope=social&viewer=${encodeURIComponent(actor.handle || actor.did)}" class="btn btn-primary">
          Friends Leaderboards &rarr;
        </a>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${Number(profile.gamesPlayed)}</div>
          <div class="stat-label">Games Played</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(profile.completedGames)}</div>
          <div class="stat-label">100% Completed Games</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(profile.totalUnlocks)}</div>
          <div class="stat-label">Verified Unlocks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(profile.tiers.platinum)} / ${Number(profile.tiers.gold)} / ${Number(profile.tiers.silver)} / ${Number(profile.tiers.bronze)}</div>
          <div class="stat-label">Plat / Gold / Silver / Bronze</div>
        </div>
      </div>

      <div class="xrpc-bar" style="margin-block-end: 0;">
        <span>Gamercard XRPC: <code>${esc(xrpcUrl)}</code></span>
        <a href="${esc(xrpcUrl)}" target="_blank" rel="noopener" class="btn btn-subtle">Raw JSON &nearr;</a>
      </div>
    </section>

    ${standingsHtml}

    <section class="section-block">
      <div class="section-header">
        <h2>Per-Game Achievement Progress</h2>
      </div>
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        ${gamesHtml}
      </div>
    </section>
  `;
}

async function renderAuditLedger() {
  document.title = 'Revocations & Anti-Cheat Ledger | opengaming.games';
  const data = await fetchJson('/api/audit');

  const revBody = data.revocations.length
    ? `<ul class="cards-grid single-col-grid" role="list">${data.revocations
        .map(
          (r) => `
          <li class="card">
            <div class="pill-row space-between">
              <span class="proof-chip revoked">Scope: ${esc(r.scope)} &middot; ${esc(r.reason)}</span>
              <span class="muted-text">${formatTime(r.revokedAt)}</span>
            </div>
            <dl class="kv-dl mb-0">
              <dt>Revocation URI</dt>
              <dd><code>${esc(r.uri)}</code></dd>
              <dt>Player</dt>
              <dd>@${esc(r.playerHandle || r.playerDid)} (<code>${esc(r.playerDid)}</code>)</dd>
              <dt>Subject</dt>
              <dd><code>${esc(r.subjectUri)}</code></dd>
              ${r.attestationCid ? `<dt>Revoked CID</dt><dd><code>${esc(r.attestationCid)}</code></dd>` : ''}
              ${r.before ? `<dt>Patch Cutoff</dt><dd><code>${esc(r.before)}</code></dd>` : ''}
              ${r.note ? `<dt>Publisher Note</dt><dd>${esc(r.note)}</dd>` : ''}
            </dl>
          </li>
        `
        )
        .join('')}</ul>`
    : '<p class="card muted-text">No revocations published.</p>';

  const labelsList = Array.isArray(data.moderationLabels) ? data.moderationLabels : [];
  const labelsBody = labelsList.length
    ? `<ul class="cards-grid single-col-grid" role="list">${labelsList
        .map(
          (l) => `
          <li class="card">
            <div class="pill-row space-between">
              <span class="proof-chip ${l.neg ? 'verified' : 'revoked'}">${l.neg ? 'Negated Label' : 'Active Label'}: <code>${esc(l.val)}</code></span>
              <span class="muted-text">${formatTime(l.cts)}</span>
            </div>
            <dl class="kv-dl mb-0">
              <dt>Labeler DID</dt>
              <dd><code>${esc(l.src)}</code></dd>
              <dt>Target URI / DID</dt>
              <dd><code>${esc(l.uri)}</code></dd>
              ${l.cid ? `<dt>Target CID</dt><dd><code>${esc(l.cid)}</code></dd>` : ''}
            </dl>
          </li>
        `
        )
        .join('')}</ul>`
    : '<p class="card muted-text">No ATProto moderation or replay-verification labels ingested yet.</p>';

  const rejectedBody = data.rejectedRecords.length
    ? `<ul class="cards-grid single-col-grid" role="list">${data.rejectedRecords
        .map(
          (rec) => `
          <li class="card">
            <div class="pill-row space-between">
              <span class="badge">${esc(rec.kind)}</span>
              <button type="button" class="proof-chip revoked" data-proof-uri="${esc(rec.uri)}">
                ${rec.revoked ? `Revoked (${esc(rec.revocationReason || 'revoked')})` : `Rejected (${esc(rec.error)})`} &middot; Inspect
              </button>
            </div>
            <p class="muted-text mb-0">${esc(rec.message || '')}</p>
            <div class="muted-text">Record: <code>${esc(rec.uri)}</code></div>
          </li>
        `
        )
        .join('')}</ul>`
    : '<p class="card muted-text">No rejected or revoked records observed.</p>';

  return `
    <div class="section-header">
      <div>
        <h1 id="view-heading" tabindex="-1">Verification, Labeler &amp; Revocation Audit Ledger</h1>
        <p class="muted-text">
          Co-equal moderation: publisher <code>games.opengaming.revocation</code> records handle surgical <code>attestationCid</code> &amp; patch-cutoff invalidation, while ATProto Labelers (<code>com.atproto.label.defs#label</code>) provide federated anti-cheat moderation and post-EoS community replay verification.
        </p>
      </div>
    </div>

    <div class="two-col-grid section-block">
      <section>
        <h2>Published Revocations (<code>games.opengaming.revocation</code>)</h2>
        ${revBody}
      </section>

      <section>
        <h2>ATProto Labeler Events (<code>com.atproto.label.defs#label</code>)</h2>
        ${labelsBody}
      </section>
    </div>

    <section class="section-block">
      <h2>Excluded Player Records (Revoked, Labeled, or Unverified)</h2>
      ${rejectedBody}
    </section>
  `;
}

async function renderDevelopers() {
  document.title = 'Lexicons & XRPC API | opengaming.games';
  const [{ lexicons }, { leaderboards }] = await Promise.all([
    fetchJson('/api/lexicons'),
    fetchJson('/api/leaderboards').catch(() => ({ leaderboards: [] })),
  ]);

  const liveLbUri =
    leaderboards?.[0]?.uri ||
    'at://did:web:flappysky.symmetricalboy.com/games.opengaming.leaderboard.definition/high-score';
  const liveLbQuery = `/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(liveLbUri)}&timeframe=allTime&scope=public`;

  const schemasHtml = lexicons
    .map(
      (doc) => `
      <details name="lexicon-accordion" class="card">
        <summary class="lexicon-summary">
          <code>${esc(doc.id)}</code> &mdash; <span class="muted-text">${esc(doc.description || '')}</span>
        </summary>
        <pre tabindex="0"><code>${esc(JSON.stringify(doc, null, 2))}</code></pre>
      </details>
    `
    )
    .join('');

  return `
    <div class="section-header">
      <div>
        <h1 id="view-heading" tabindex="-1">Open Gaming Lexicons &amp; XRPC Endpoints</h1>
        <p class="muted-text">
          9 self-contained AT Protocol Lexicon v1 schemas under <code>games.opengaming.*</code> (designed for 1:1 adoption into the ATmosphere Gaming Working Group namespace).
        </p>
      </div>
    </div>

    <section class="section-block">
      <h2>Schema Design Highlights</h2>
      <ul class="cards-grid" role="list">
        <li class="card">
          <h3>Spoiler-Proof Hidden Stubs + ATProto Spaces</h3>
          <p class="muted-text">
            <code>achievement.definition</code> allows omitting <code>title</code>, <code>description</code>, and <code>icon</code> when <code>hidden: true</code>, preventing Firehose/PDS spoiler leaks while pointing to an access-controlled <code>hiddenSpace</code> URI revealed upon unlock.
          </p>
        </li>
        <li class="card">
          <h3>Forward-Compatible Component Maps &amp; Open Unions</h3>
          <p class="muted-text">
            Multi-component leaderboards use a dictionary <code>components</code> map (<code>$keyFormat</code>/<code>$valueType</code> convention + <code>componentOrder</code>) positioned for zero-migration adoption of the proposed Lexicon <code>map</code> type—without breaking PDS records or DAG-CBOR attestation CIDs—plus open-union <code>details</code> (<code>#judgmentBreakdown</code>).
          </p>
        </li>
        <li class="card">
          <h3>Legal Chart / Build Hashes (<code>rankedVersions</code>)</h3>
          <p class="muted-text">
            Leaderboards declare legal chart/patch hashes via <code>rankedVersions</code>; <code>getScores</code> filters active rankings by <code>version</code> while keeping historical pre-patch scores intact in players' PDSs.
          </p>
        </li>
        <li class="card">
          <h3>EoS Continuity, Multi-Issuer &amp; Replay Blobs</h3>
          <p class="muted-text">
            <code>trustedIssuers</code> lets federated hosts and post-EoS revival servers attest runs; <code>$sig.rkey</code> prevents label-evasion copying; optional <code>replay</code> blobs + <code>verified-replay</code> labels enable serverless verification.
          </p>
        </li>
        <li class="card">
          <h3>ATProto Labelers + Publisher Revocations</h3>
          <p class="muted-text">
            Co-equal moderation folding <code>com.atproto.label.defs#label</code> events (<code>!cheat</code>, <code>neg: true</code> appeals) alongside publisher <code>games.opengaming.revocation</code> records, plus symmetric optional <code>definitionCid</code> across <code>unlock</code>, <code>progress</code>, and <code>score</code>.
          </p>
        </li>
      </ul>
    </section>

    <section class="card section-block">
      <h2>Live Public XRPC Endpoints on This AppView</h2>
      <ul role="list">
        <li>
          <a href="/xrpc/games.opengaming.actor.getProfile?actor=symmetricalboy.com" target="_blank" rel="noopener">
            <code>GET /xrpc/games.opengaming.actor.getProfile?actor=symmetricalboy.com</code>
          </a>
        </li>
        <li>
          <a href="${esc(liveLbQuery)}" target="_blank" rel="noopener">
            <code>GET /xrpc/games.opengaming.leaderboard.getScores?leaderboard=${esc(liveLbUri)}&amp;timeframe=allTime&amp;scope=public</code>
          </a>
        </li>
      </ul>
    </section>

    <section class="section-block">
      <h2>Canonical Lexicon v1 Schemas (${Number(lexicons.length)})</h2>
      <div class="stack-list">
        ${schemasHtml}
      </div>
    </section>
  `;
}

/* --- Router with Same-Document View Transitions & Focus Management --- */
function updateActiveNav(pathname) {
  for (const link of document.querySelectorAll('.primary-nav a[data-nav]')) {
    const linkPath = new URL(link.getAttribute('href'), window.location.origin).pathname;
    const isMatch =
      linkPath === '/'
        ? pathname === '/'
        : pathname === linkPath || (linkPath === '/games' && pathname === '/game');
    if (isMatch) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

async function renderCurrentRoute({ moveFocus = false } = {}) {
  const url = new URL(window.location.href);
  const { pathname, searchParams } = url;
  updateActiveNav(pathname);

  let html = '';
  try {
    if (pathname === '/' || pathname === '') {
      html = await renderOverview();
    } else if (pathname === '/games') {
      html = await renderGamesCatalog();
    } else if (pathname === '/game') {
      html = await renderGameDetail(searchParams);
    } else if (pathname === '/leaderboards') {
      html = await renderLeaderboards(searchParams);
    } else if (pathname === '/player') {
      html = await renderPlayerGamercard(searchParams);
    } else if (pathname === '/audit') {
      html = await renderAuditLedger();
    } else if (pathname === '/developers') {
      html = await renderDevelopers();
    } else {
      document.title = 'Not Found | opengaming.games';
      html = `<div class="card"><h1 id="view-heading" tabindex="-1">Page Not Found</h1><p><a href="/" data-nav="/">Return to Overview</a></p></div>`;
    }
  } catch (err) {
    document.title = 'Error | opengaming.games';
    html = `
      <div class="card">
        <h1 id="view-heading" tabindex="-1">Unable to Load View</h1>
        <p class="muted-text">${esc(err.message)}</p>
        <p><a href="/" data-nav="/" class="btn btn-subtle">Back to Overview</a></p>
      </div>
    `;
  }

  const commitDom = () => {
    appRoot.innerHTML = html;
  };

  if (moveFocus && document.startViewTransition) {
    const transition = document.startViewTransition(commitDom);
    transition.finished.finally(() => {
      document.getElementById('view-heading')?.focus();
    });
  } else {
    commitDom();
    if (moveFocus) {
      document.getElementById('view-heading')?.focus();
    }
  }
}

function navigateTo(href) {
  const targetUrl = new URL(href, window.location.origin);
  if (targetUrl.href !== window.location.href) {
    window.history.pushState({}, '', targetUrl.pathname + targetUrl.search);
  }
  if (syncDialog.open) syncDialog.close();
  void renderCurrentRoute({ moveFocus: true });
}

/* --- Delegated Event Listeners --- */
document.addEventListener('click', (e) => {
  const proofBtn = e.target.closest('[data-proof-uri]');
  if (proofBtn) {
    e.preventDefault();
    void openProofInspector(proofBtn.getAttribute('data-proof-uri'));
    return;
  }

  const navEl = e.target.closest('[data-nav]');
  if (navEl && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    navigateTo(navEl.getAttribute('data-nav'));
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'leaderboard-select') {
    navigateTo(`/leaderboards?leaderboard=${encodeURIComponent(e.target.value)}`);
  }
});

document.addEventListener('submit', (e) => {
  if (e.target === lookupForm) {
    e.preventDefault();
    const actor = lookupInput.value.trim();
    if (actor) {
      navigateTo(`/player?actor=${encodeURIComponent(actor)}`);
    }
    return;
  }

  if (e.target.id === 'game-viewer-filter-form') {
    e.preventDefault();
    const gameUri = e.target.getAttribute('data-game-uri');
    const viewer = document.getElementById('game-viewer-input')?.value.trim() || '';
    navigateTo(`/game?uri=${encodeURIComponent(gameUri)}${viewer ? `&viewer=${encodeURIComponent(viewer)}` : ''}`);
    return;
  }

  if (e.target.id === 'lb-viewer-form') {
    e.preventDefault();
    const lbUri = e.target.getAttribute('data-lb-uri');
    const timeframe = e.target.getAttribute('data-timeframe') || 'allTime';
    const scope = e.target.getAttribute('data-scope') || 'social';
    const sortBy = e.target.getAttribute('data-sort-by') || '';
    const version = e.target.getAttribute('data-version') || '';
    const viewer = document.getElementById('lb-viewer-input')?.value.trim() || '';
    const next = new URLSearchParams({ leaderboard: lbUri, timeframe, scope });
    if (viewer) next.set('viewer', viewer);
    if (sortBy) next.set('sortBy', sortBy);
    if (version) next.set('version', version);
    navigateTo(`/leaderboards?${next.toString()}`);
  }
});

window.addEventListener('popstate', () => {
  void renderCurrentRoute({ moveFocus: true });
});

void renderCurrentRoute({ moveFocus: false });
