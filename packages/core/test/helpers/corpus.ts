import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type CorpusCase, CorpusError, parseCase } from "../../src/eval/corpus.ts";

/** Reads one case file; `file` is used verbatim in every error message. */
export function loadCase(file: string): CorpusCase {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new CorpusError(
      file,
      `cannot read the case file: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parseCase(text, file);
}

/**
 * Loads every `<root>/<case-id>/case.json`, sorted by directory name. A missing `case.json`,
 * a directory whose name disagrees with the case id, and a duplicate id are errors.
 */
export function loadCorpus(root: string): CorpusCase[] {
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const cases: CorpusCase[] = [];
  const seen = new Map<string, string>();
  for (const dir of dirs) {
    const file = join(root, dir, "case.json");
    if (!existsSync(file)) throw new CorpusError(file, "missing case.json");
    const c = loadCase(file);
    if (basename(dirname(file)) !== c.id) {
      throw new CorpusError(file, `id "${c.id}" does not match its directory "${dir}"`);
    }
    const previous = seen.get(c.id);
    if (previous !== undefined) {
      throw new CorpusError(file, `duplicate case id "${c.id}" (also ${previous})`);
    }
    seen.set(c.id, file);
    cases.push(c);
  }
  return cases;
}
