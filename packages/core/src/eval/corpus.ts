import { z } from "zod";
import { isValidAddress, isValidTx } from "../chains.ts";
import { FLAG_IDS } from "../policy/policy.ts";
import { ChainIdSchema, DirectionSchema, LabelCategorySchema } from "../schema.ts";

/** A case is an annotation, not a recording: anything larger is a raw response in disguise. */
export const MAX_CASE_BYTES = 256 * 1024;

/** Keys that would carry a raw explorer response into the corpus (case and separators ignored). */
const RAW_BODY_KEYS = new Set([
  "body",
  "raw",
  "rawbody",
  "response",
  "responsebody",
  "httptrace",
  "payload",
  "explorerresponse",
]);

function isRawBodyKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
  return (
    RAW_BODY_KEYS.has(normalized) || normalized.includes("response") || normalized.endsWith("body")
  );
}

/** A corpus file the loader refused, with the file and the offending field in the message. */
export class CorpusError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "CorpusError";
  }
}

const SeedSchema = z.strictObject({
  id: z.string().regex(/^s([1-9]|1[0-9]|20)$/),
  kind: z.enum(["tx", "address"]),
  value: z.string().min(1),
});

const ExpectedEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  txHash: z.string().min(1).nullable().default(null),
  assetId: z.string().min(1).nullable().default(null),
  amount: z.number().positive().nullable().default(null),
});

const ExpectedEntitySchema = z.strictObject({
  id: z.string().min(1),
  category: LabelCategorySchema,
  addresses: z.array(z.strictObject({ chain: ChainIdSchema, address: z.string().min(1) })).min(1),
});

const SourceSchema = z.strictObject({
  kind: z.enum(["incident_report", "enforcement_action", "internal_review"]),
  url: z.url().nullable().default(null),
  note: z.string().min(1).nullable().default(null),
});

/**
 * One annotated case (design doc, "Validation"). `expected` records only what a reviewer
 * confirmed; ambiguity belongs in the review notes, never in the expectations.
 */
export const CorpusCaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  scenario: z.enum(["asset_migration", "risk_propagation"]),
  chain: ChainIdSchema,
  direction: DirectionSchema,
  seeds: z.array(SeedSchema).min(1).max(20),
  expected: z.strictObject({
    edges: z.array(ExpectedEdgeSchema),
    entities: z.array(ExpectedEntitySchema),
    riskFactors: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)),
  }),
  annotations: z.strictObject({
    reviewedBy: z.string().min(1),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sources: z.array(SourceSchema).min(1),
  }),
});
export type CorpusCase = z.infer<typeof CorpusCaseSchema>;

/** Dotted paths of every key that would carry a raw explorer response, in document order. */
function rawBodyPaths(value: unknown, path: readonly string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => rawBodyPaths(item, [...path, String(i)]));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    isRawBodyKey(key) ? [[...path, key].join(".")] : rawBodyPaths(child, [...path, key]),
  );
}

function chainProblems(c: CorpusCase): string[] {
  const problems: string[] = [];
  const seenSeeds = new Set<string>();
  for (const seed of c.seeds) {
    if (seenSeeds.has(seed.id)) problems.push(`seeds: duplicate id "${seed.id}"`);
    seenSeeds.add(seed.id);
    const valid =
      seed.kind === "tx" ? isValidTx(c.chain, seed.value) : isValidAddress(c.chain, seed.value);
    if (!valid) problems.push(`seeds.${seed.id}.value: not a valid ${c.chain} ${seed.kind}`);
  }
  c.expected.edges.forEach((edge, i) => {
    for (const side of ["from", "to"] as const) {
      if (!isValidAddress(c.chain, edge[side])) {
        problems.push(`expected.edges.${i}.${side}: not a valid ${c.chain} address`);
      }
    }
    if (edge.txHash !== null && !isValidTx(c.chain, edge.txHash)) {
      problems.push(`expected.edges.${i}.txHash: not a valid ${c.chain} transaction hash`);
    }
  });
  c.expected.entities.forEach((entity, i) => {
    entity.addresses.forEach((a, j) => {
      if (!isValidAddress(a.chain, a.address)) {
        problems.push(`expected.entities.${i}.addresses.${j}: not a valid ${a.chain} address`);
      }
    });
  });
  const flags = new Set<string>(FLAG_IDS);
  c.expected.riskFactors.forEach((id, i) => {
    if (!flags.has(id)) problems.push(`expected.riskFactors.${i}: unknown flag id "${id}"`);
  });
  return problems;
}

/**
 * Parses and validates one case file. Every failure is a `CorpusError` naming the file and
 * the offending field, so a bad annotation fails the evaluation with an actionable message.
 */
export function parseCase(text: string, file: string): CorpusCase {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_CASE_BYTES) {
    throw new CorpusError(
      file,
      `case is ${bytes} bytes, above the ${MAX_CASE_BYTES}-byte limit (raw explorer responses belong outside the corpus)`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new CorpusError(file, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const rawPaths = rawBodyPaths(json);
  if (rawPaths.length > 0) {
    throw new CorpusError(file, `raw explorer responses are not allowed (found "${rawPaths[0]}")`);
  }

  const parsed = CorpusCaseSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new CorpusError(file, issues.join("; "));
  }

  const problems = chainProblems(parsed.data);
  if (problems.length > 0) throw new CorpusError(file, problems.join("; "));

  return parsed.data;
}
