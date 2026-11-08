#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AtpAgent } from '@atproto/api';
import { jsonToLex } from '@atproto/lexicon';
import {
  createOpenGamingLexicons,
  loadOpenGamingLexiconDocs,
} from './lexicons.js';
import { generateSigningKeys, loadSigningKey } from './keys.js';
import { registerAttestationKey, requestPlcOperationToken } from './plc.js';
import {
  createSignedScore,
  createSignedUnlock,
  verifyRecordAttestation,
} from './attestation.js';
import { resolveActiveLabels } from './labels.js';
import {
  createRevocationRecord,
  publishRevocation,
  reinstateRevocation,
} from './revocation.js';
import {
  validateComponentDefs,
  validateScoreComponents,
} from './leaderboards.js';
import { NSIDS } from './constants.js';
import type {
  AtprotoLabel,
  LeaderboardDefinitionRecord,
  RevocationReason,
  RevocationRecord,
  RevocationScope,
  ScoreComponentValMap,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

const HELP_TEXT = `
Open Gaming CLI (games.opengaming.*)

Usage:
  opengaming <command> [options]

Commands:
  keygen                 Generate a P-256 inline attestation keypair
  plc-request-token      Email a PLC confirmation token to register #attestations
  plc-register-key       Register your public did:key under #attestations on PLC
  validate               Validate Lexicon schemas and example records
  sign-unlock            Create & inline-sign an achievement.unlock record
  sign-score             Create & inline-sign a leaderboard.score record (single or multi-component)
  verify                 Verify a record (inline attestations, multi-issuer, revocations, & ATProto labels)
  revoke                 Create (and optionally publish) a games.opengaming.revocation record
  unrevoke               Delete a revocation record from the game publisher's PDS

Run "opengaming <command> --help" or see docs/SDK_AND_CLI.md for examples.
`.trim();

async function createAuthedAgent(service: string, identifier: string, password: string): Promise<AtpAgent> {
  const agent = new AtpAgent({ service });
  await agent.login({ identifier, password });
  return agent;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP_TEXT);
    return;
  }

  switch (command) {
    case 'keygen': {
      const { values } = parseArgs({
        args: rest,
        options: {
          out: { type: 'string' },
        },
      });
      const keys = await generateSigningKeys();
      if (values.out) {
        const outDir = path.resolve(values.out);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'opengaming.private.key'), keys.privateKeyBase64url + '\n', {
          encoding: 'utf8',
          mode: 0o600,
        });
        fs.writeFileSync(path.join(outDir, 'opengaming.public.txt'), keys.publicDidKey + '\n', 'utf8');
        console.log(`Saved keys to ${outDir}`);
        console.log(`Public DID Key (#attestations): ${keys.publicDidKey}`);
      } else {
        console.log(
          JSON.stringify(
            {
              publicDidKey: keys.publicDidKey,
              privateKeyBase64url: keys.privateKeyBase64url,
              note: 'Keep privateKeyBase64url secret (OPENGAMING_PRIVATE_KEY). Publish publicDidKey to #attestations in your DID document.',
            },
            null,
            2
          )
        );
      }
      break;
    }

    case 'plc-request-token': {
      const { values } = parseArgs({
        args: rest,
        options: {
          service: { type: 'string', default: 'https://bsky.social' },
          identifier: { type: 'string' },
          password: { type: 'string' },
        },
      });
      const password = values.password ?? process.env.ATP_PASSWORD;
      if (!values.identifier || !password) {
        throw new Error('Required: --identifier <handle/did> and --password <password> (or ATP_PASSWORD env).');
      }
      const agent = await createAuthedAgent(values.service!, values.identifier, password);
      await requestPlcOperationToken(agent);
      console.log(`PLC confirmation token requested for ${agent.session?.did}. Check your account email.`);
      break;
    }

    case 'plc-register-key': {
      const { values } = parseArgs({
        args: rest,
        options: {
          service: { type: 'string', default: 'https://bsky.social' },
          identifier: { type: 'string' },
          password: { type: 'string' },
          'public-key': { type: 'string' },
          token: { type: 'string' },
        },
      });
      const password = values.password ?? process.env.ATP_PASSWORD;
      if (!values.identifier || !password || !values['public-key'] || !values.token) {
        throw new Error(
          'Required: --identifier <handle/did> --password <pw> --public-key <did:key:...> --token <email-token>'
        );
      }
      const agent = await createAuthedAgent(values.service!, values.identifier, password);
      const did = agent.session!.did;
      await registerAttestationKey({
        agent,
        did,
        publicDidKey: values['public-key'],
        token: values.token,
      });
      console.log(`Registered ${did}#attestations -> ${values['public-key']}`);
      break;
    }

    case 'validate': {
      const { values } = parseArgs({
        args: rest,
        options: {
          lexicons: { type: 'string' },
          examples: { type: 'string' },
        },
      });
      const docs = loadOpenGamingLexiconDocs(values.lexicons ? path.resolve(values.lexicons) : undefined);
      const lex = createOpenGamingLexicons(values.lexicons ? path.resolve(values.lexicons) : undefined);
      console.log(`Loaded & compiled ${docs.length} Lexicon schemas:`);
      for (const doc of docs) {
        console.log(`  - ${doc.id}`);
      }

      const defaultExamples = path.resolve(
        values.examples ?? path.join(REPO_ROOT, 'examples/flappysky.examples.json')
      );
      if (fs.existsSync(defaultExamples)) {
        const rawExamples = JSON.parse(fs.readFileSync(defaultExamples, 'utf8')) as Record<string, any>;
        const recordsToCheck: Array<{ label: string; nsid: string; value: unknown }> = [];

        for (const [key, entry] of Object.entries(rawExamples)) {
          if (key.startsWith('$')) continue;
          const items = Array.isArray(entry) ? entry : [entry];
          for (const item of items) {
            const val = item?.value ?? item;
            if (val && typeof val.$type === 'string' && val.$type.startsWith('games.opengaming.')) {
              recordsToCheck.push({ label: item.uri ?? key, nsid: val.$type, value: val });
            }
          }
        }

        const defByUri = new Map<string, LeaderboardDefinitionRecord>();
        for (const rec of recordsToCheck) {
          const hydrated = jsonToLex(rec.value as Record<string, unknown>);
          lex.assertValidRecord(rec.nsid, hydrated);

          if (rec.nsid === NSIDS.LeaderboardDefinition) {
            const def = rec.value as LeaderboardDefinitionRecord;
            const defErr = validateComponentDefs(def.components, def.componentOrder);
            if (defErr) {
              throw new Error(`${rec.label}: ${defErr}`);
            }
            defByUri.set(rec.label, def);
          }
        }
        for (const rec of recordsToCheck) {
          if (rec.nsid === NSIDS.LeaderboardScore) {
            const scoreRec = rec.value as { leaderboard?: string; components?: ScoreComponentValMap };
            const def = scoreRec.leaderboard ? defByUri.get(scoreRec.leaderboard) : undefined;
            if (def) {
              const compErr = validateScoreComponents(scoreRec.components, def);
              if (compErr) {
                throw new Error(`${rec.label}: ${compErr}`);
              }
            }
          }
        }
        console.log(`Validated ${recordsToCheck.length} Open Gaming example records in ${path.basename(defaultExamples)}.`);
      }
      break;
    }

    case 'sign-unlock': {
      const { values } = parseArgs({
        args: rest,
        options: {
          achievement: { type: 'string' },
          player: { type: 'string' },
          issuer: { type: 'string' },
          game: { type: 'string' },
          rkey: { type: 'string' },
          'private-key': { type: 'string' },
        },
      });
      const priv = values['private-key'] ?? process.env.OPENGAMING_PRIVATE_KEY;
      if (!values.achievement || !values.player || !values.issuer || !priv) {
        throw new Error(
          'Required: --achievement <at-uri> --player <did> --issuer <did> --private-key <base64url> (or OPENGAMING_PRIVATE_KEY)'
        );
      }
      const signingKey = await loadSigningKey(priv);
      const result = await createSignedUnlock({
        achievement: values.achievement,
        playerDid: values.player,
        issuerDid: values.issuer,
        game: values.game,
        rkey: values.rkey,
        signingKey,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'sign-score': {
      const { values } = parseArgs({
        args: rest,
        options: {
          leaderboard: { type: 'string' },
          score: { type: 'string' },
          components: { type: 'string' },
          version: { type: 'string' },
          rkey: { type: 'string' },
          player: { type: 'string' },
          issuer: { type: 'string' },
          game: { type: 'string' },
          'display-score': { type: 'string' },
          tag: { type: 'string' },
          'private-key': { type: 'string' },
        },
      });
      const priv = values['private-key'] ?? process.env.OPENGAMING_PRIVATE_KEY;
      if (!values.leaderboard || (values.score === undefined && !values.components) || !values.player || !values.issuer || !priv) {
        throw new Error(
          'Required: --leaderboard <at-uri> (--score <int> | --components <json>) --player <did> --issuer <did> --private-key <base64url>'
        );
      }
      const parsedScore = values.score !== undefined ? Number.parseInt(values.score, 10) : undefined;
      if (values.score !== undefined && !Number.isInteger(parsedScore)) {
        throw new Error(`Invalid integer score: "${values.score}"`);
      }
      let parsedComponents: ScoreComponentValMap | undefined;
      if (values.components) {
        const rawComp = JSON.parse(values.components) as unknown;
        if (!rawComp || typeof rawComp !== 'object' || Array.isArray(rawComp)) {
          throw new Error('--components must be a JSON dictionary object keyed by component id (not an array).');
        }
        parsedComponents = rawComp as ScoreComponentValMap;
      }
      const signingKey = await loadSigningKey(priv);
      const result = await createSignedScore({
        leaderboard: values.leaderboard,
        score: parsedScore,
        components: parsedComponents,
        version: values.version,
        rkey: values.rkey,
        playerDid: values.player,
        issuerDid: values.issuer,
        game: values.game,
        displayScore: values['display-score'],
        tag: values.tag,
        signingKey,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'verify': {
      const { values } = parseArgs({
        args: rest,
        options: {
          file: { type: 'string' },
          player: { type: 'string' },
          'record-uri': { type: 'string' },
          issuer: { type: 'string' },
          'trusted-issuers': { type: 'string' },
          'allow-any-issuer': { type: 'boolean', default: false },
          'allow-community-labels': { type: 'boolean', default: false },
          'public-key': { type: 'string' },
          revocations: { type: 'string' },
          labels: { type: 'string' },
        },
      });
      if (!values.file || !values.player) {
        throw new Error('Required: --file <record.json> --player <player-did>');
      }
      const parsed = JSON.parse(fs.readFileSync(path.resolve(values.file), 'utf8'));
      const record = parsed.record ?? parsed.value ?? parsed;
      const recordUri = values['record-uri'] ?? parsed.uri;

      let revocations: RevocationRecord[] = [];
      if (values.revocations) {
        const revRaw = JSON.parse(fs.readFileSync(path.resolve(values.revocations), 'utf8'));
        const arr = Array.isArray(revRaw) ? revRaw : [revRaw];
        revocations = arr.map((item) => item.record ?? item.value ?? item);
      }

      let activeLabels: AtprotoLabel[] = [];
      if (values.labels) {
        const lblRaw = JSON.parse(fs.readFileSync(path.resolve(values.labels), 'utf8'));
        const arr = Array.isArray(lblRaw) ? lblRaw : [lblRaw];
        activeLabels = resolveActiveLabels(arr);
      }

      const trustedIssuerDids = values['trusted-issuers']
        ? values['trusted-issuers']
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const verification = await verifyRecordAttestation({
        record,
        playerDid: values.player,
        recordUri,
        expectedIssuerDid: values.issuer,
        trustedIssuerDids,
        allowAnyValidIssuer: values['allow-any-issuer'],
        allowCommunityLabelVerification: values['allow-community-labels'],
        publicDidKey: values['public-key'],
        revocations,
        activeLabels,
      });
      console.log(JSON.stringify(verification, null, 2));
      if (!verification.verified) {
        process.exitCode = 1;
      }
      break;
    }

    case 'revoke': {
      const { values } = parseArgs({
        args: rest,
        options: {
          scope: { type: 'string', default: 'attestation' },
          cid: { type: 'string' },
          player: { type: 'string' },
          subject: { type: 'string' },
          'record-uri': { type: 'string' },
          before: { type: 'string' },
          reason: { type: 'string', default: 'cheating' },
          note: { type: 'string' },
          publish: { type: 'boolean', default: false },
          service: { type: 'string', default: 'https://bsky.social' },
          identifier: { type: 'string' },
          password: { type: 'string' },
        },
      });
      if (!values.player || !values.subject) {
        throw new Error('Required: --player <did> --subject <at-uri> [--cid <attestationCid>]');
      }
      const params = {
        scope: values.scope as RevocationScope,
        attestationCid: values.cid,
        player: values.player,
        subject: values.subject,
        recordUri: values['record-uri'],
        before: values.before,
        reason: values.reason as RevocationReason,
        note: values.note,
      };
      if (values.publish) {
        const password = values.password ?? process.env.ATP_PASSWORD;
        if (!values.identifier || !password) {
          throw new Error('--publish requires --identifier <handle/did> and --password <pw> (or ATP_PASSWORD).');
        }
        const agent = await createAuthedAgent(values.service!, values.identifier, password);
        const published = await publishRevocation({
          ...params,
          agent,
          issuerDid: agent.session!.did,
        });
        console.log(JSON.stringify(published, null, 2));
      } else {
        const built = createRevocationRecord(params);
        console.log(JSON.stringify(built, null, 2));
      }
      break;
    }

    case 'unrevoke': {
      const { values } = parseArgs({
        args: rest,
        options: {
          rkey: { type: 'string' },
          service: { type: 'string', default: 'https://bsky.social' },
          identifier: { type: 'string' },
          password: { type: 'string' },
        },
      });
      const password = values.password ?? process.env.ATP_PASSWORD;
      if (!values.rkey || !values.identifier || !password) {
        throw new Error('Required: --rkey <attestationCid-or-rkey> --identifier <handle/did> --password <pw>');
      }
      const agent = await createAuthedAgent(values.service!, values.identifier, password);
      await reinstateRevocation({
        agent,
        issuerDid: agent.session!.did,
        rkey: values.rkey,
      });
      console.log(`Deleted revocation at://${agent.session!.did}/${NSIDS.Revocation}/${values.rkey}`);
      break;
    }

    default:
      throw new Error(`Unknown command "${command}". Run "opengaming --help" for usage.`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
