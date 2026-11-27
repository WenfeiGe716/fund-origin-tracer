import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorpusError, MAX_CASE_BYTES, parseCase } from "../src/eval/corpus.ts";
import { loadCase, loadCorpus } from "./helpers/corpus.ts";

const CORPORA = join(import.meta.dir, "corpora");
const BRIDGE_CASE = join(CORPORA, "sample-bridge-migration", "case.json");
const bridgeJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(BRIDGE_CASE, "utf8")) as Record<string, unknown>;

describe("corpus loader", () => {
  test("loads the three sample cases sorted by id", () => {
    const cases = loadCorpus(CORPORA);
    expect(cases.map((c) => c.id)).toEqual([
      "sample-bridge-migration",
      "sample-mixer-exposure",
      "sample-scam-cross-asset",
    ]);
    expect(new Set(cases.map((c) => c.scenario))).toEqual(
      new Set(["asset_migration", "risk_propagation"]),
    );
    const bridge = cases[0];
    expect(bridge?.expected.edges).toHaveLength(1);
    expect(bridge?.expected.entities[0]?.category).toBe("bridge");
    expect(cases[1]?.expected.riskFactors).toEqual(["mixer_direct"]);
  });

  test("rejects a case whose id does not match its directory", () => {
    const root = mkdtempSync(join(tmpdir(), "fot-corpus-"));
    mkdirSync(join(root, "wrong-directory"));
    copyFileSync(BRIDGE_CASE, join(root, "wrong-directory", "case.json"));
    expect(() => loadCorpus(root)).toThrow(/does not match its directory "wrong-directory"/);
  });

  test("rejects a directory without case.json", () => {
    const root = mkdtempSync(join(tmpdir(), "fot-corpus-"));
    mkdirSync(join(root, "empty-case"));
    expect(() => loadCorpus(root)).toThrow(/empty-case\/case\.json: missing case\.json/);
  });
});

describe("case validation", () => {
  test("names the file and the field of a malformed case", () => {
    const json = bridgeJson();
    delete json.chain;
    const file = "corpora/broken/case.json";
    let error: unknown;
    try {
      parseCase(JSON.stringify(json), file);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CorpusError);
    expect((error as Error).message).toContain(`${file}: `);
    expect((error as Error).message).toContain("chain:");
  });

  test("rejects a raw explorer response at the top level and nested", () => {
    const top = { ...bridgeJson(), rawResponse: '{"status":"1","result":[]}' };
    expect(() => parseCase(JSON.stringify(top), "a.json")).toThrow(
      /raw explorer responses are not allowed \(found "rawResponse"\)/,
    );

    const nested = bridgeJson();
    const expected = nested.expected as { edges: Record<string, unknown>[] };
    expected.edges[0] = { ...expected.edges[0], body: "0x00" };
    expect(() => parseCase(JSON.stringify(nested), "b.json")).toThrow(/expected\.edges\.0\.body/);
  });

  test("rejects a case above the size limit", () => {
    const text = "x".repeat(MAX_CASE_BYTES + 1);
    expect(() => parseCase(text, "big/case.json")).toThrow(
      new RegExp(`${MAX_CASE_BYTES}-byte limit`),
    );
  });

  test("rejects an address that does not match the case chain", () => {
    const json = bridgeJson();
    const seeds = json.seeds as Record<string, unknown>[];
    if (seeds[0]) seeds[0].value = "0x123";
    expect(() => parseCase(JSON.stringify(json), "c.json")).toThrow(
      /seeds\.s1\.value: not a valid ethereum tx/,
    );
  });

  test("rejects an unknown risk factor", () => {
    const json = bridgeJson();
    const expected = json.expected as Record<string, unknown>;
    expected.riskFactors = ["not_a_flag"];
    expect(() => parseCase(JSON.stringify(json), "d.json")).toThrow(/unknown flag id "not_a_flag"/);
  });

  test("rejects invalid JSON with the file name", () => {
    expect(() => parseCase("{ not json", "e.json")).toThrow(/e\.json: invalid JSON/);
  });
});

describe("the committed corpus", () => {
  test("stays small and carries no raw explorer response", () => {
    const dirs = readdirSync(CORPORA, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const file = join(CORPORA, dir.name, "case.json");
      expect(statSync(file).size).toBeLessThanOrEqual(MAX_CASE_BYTES);
      expect(loadCase(file).id).toBe(dir.name);
    }
  });
});
