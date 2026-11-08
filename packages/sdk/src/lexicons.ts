import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexicons, type LexiconDoc } from '@atproto/lexicon';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEXICONS_DIR = path.resolve(__dirname, '../../../lexicons');

/**
 * Load all `games.opengaming.*` Lexicon JSON documents from disk (defaults to repo `lexicons/`).
 */
export function loadOpenGamingLexiconDocs(lexiconsDir = DEFAULT_LEXICONS_DIR): LexiconDoc[] {
  if (!fs.existsSync(lexiconsDir)) {
    throw new Error(`Lexicons directory not found at "${lexiconsDir}".`);
  }
  const files = fs
    .readdirSync(lexiconsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  return files.map((file) => {
    const raw = fs.readFileSync(path.join(lexiconsDir, file), 'utf8');
    return JSON.parse(raw) as LexiconDoc;
  });
}

/**
 * Create a pre-populated `@atproto/lexicon` `Lexicons` validator instance containing all
 * `games.opengaming.*` schemas.
 */
export function createOpenGamingLexicons(lexiconsDir = DEFAULT_LEXICONS_DIR): Lexicons {
  const docs = loadOpenGamingLexiconDocs(lexiconsDir);
  return new Lexicons(docs);
}
