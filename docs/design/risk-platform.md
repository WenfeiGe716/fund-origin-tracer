# Design: from a case-level tracer to a risk-analysis platform

Status: draft. Nothing in this document is implemented yet; it describes the target
architecture, the changes each phase makes to this repository, and how the result is
measured. It is written to be split into issues, one per phase.

## 1. Context

`fund-origin-tracer` traces one investigation at a time: it loads up to 20 seeds, follows
transfers hop by hop with a heuristic ranking (`engine/trace.ts`, `engine/score.ts`), labels
what it meets (`labels/registry.ts`), and derives exposure, convergences, touchpoints and
policy flags (`analysis/`). Every result is a self-contained `AnalysisResult`
(`schema.ts`), stored as JSON in `investigations.result_json` and rendered by the workspace
and the report.

That is a **case** tool. The target capability is wider:

1. a list of anomalous entities, not only a graph around one seed;
2. cross-chain fund paths, not a stop at a bridge address;
3. verifiable evidence for every claim, not a chain of heuristics;
4. a contribution to macro-level risk, validated on two scenarios (anomalous asset
   migration, cross-asset risk propagation).

This document designs the path between the two, in phases that each ship something usable.

## 2. Goals and non-goals

### Goals

- Every reported conclusion can be traced back to a stored, verifiable raw response.
- Every selection decision carries a confidence, and the alternatives that lost are kept.
- Addresses aggregate into entities, and entities carry a risk profile with evidence.
- A bridge hop can be continued onto the destination chain when both legs can be matched.
- Results from many runs can be aggregated over time and space to answer "how much risk
  does this entity contribute, and through which paths".
- Each capability is measured against an annotated ground-truth set before it is called done.

### Non-goals

- Automatic determination that an entity is criminal. Output stays a lead with a confidence
  and its evidence; human review decides.
- Real-time monitoring of the whole chain. Ingestion remains request-driven per case, at
  first.
- Sanctions compliance decisions. SDN matching remains address-level screening.
- NFT, DeFi position and off-chain (CEX ledger) tracing.

## 3. Current capability and its gaps

| Capability | Today | Gap |
|---|---|---|
| Transfer graph | `engine/trace.ts` | Branches limited to `maxBranches`; dropped candidates only retained as 30 examples (`TraceEdge.dropped`) |
| Selection rationale | `selection.score`, `rank`, `breakdown` | No probability; no comparison view across candidates |
| Labels | `LabelRegistry`: bundled, local, OFAC | No confidence, no `lastVerifiedAt`, one label per address in `#entries` |
| Sanctions | `labels/ofac.ts` | Address match only, which is by design |
| Exposure | `analysis/exposure.ts` | Per run, per address; not aggregated per entity |
| Linked wallets | `analysis/convergence.ts` | Unlabeled `far` only; no clustering rules, no human confirmation |
| Cross-chain | Bridge stops the trace (`engine/trace.ts` stop set) | No deposit/release matching |
| Evidence | `RunEvent` stream, CSV/JSON export | No raw response archive, no hashes |
| Macro analysis | None | No warehouse, no propagation model |
| Validation | Unit tests, demo replays, smoke | No annotated corpus, no precision/recall |

## 4. Target architecture

```
providers/ (exists)          evidence/ (new)
  etherscan, tronscan   -->    raw response store (hash, time, request key)
        |                              ^
        v                              |
engine/trace.ts (extended: confidence, alternatives, cross-chain continuation)
        |
        +--> analysis/ (exists: exposure, convergence, flags)
        +--> entity/ (new: clustering, entity risk profile)
        +--> crosschain/ (new: bridge adapters + matcher)
        |
        v
macro/ (new: graph warehouse, aggregation windows, risk propagation)
        |
        v
apps/server (new endpoints)  -->  apps/web (entity view, evidence view, macro view)
```

The hard rules stay: `packages/core` imports only web-standard globals, all result and
event types live in `packages/core/src/schema.ts`, and core logic is test-first and offline.

## 5. Data model

All new types go into `packages/core/src/schema.ts`. `AnalysisResultSchema.schemaVersion`
moves from `1` to `2`; stored v1 results remain readable (the web must tolerate both, the
same way `droppedByReason` is optional today).

### 5.1 Edge confidence and alternatives

```ts
// Extends TraceEdgeSchema.
confidence: z.number().min(0).max(1).nullable(),   // null for older results
alternatives: z.array(z.object({
  transfer: TransferSchema,
  usd: usdSchema,
  score: z.number(),
  confidence: z.number().min(0).max(1),
  rank: z.number().int(),
})).max(10),
```

Confidence is a softmax over the selected candidates and the retained alternatives of one
expansion:

```
p_i = exp(score_i / T) / Σ_j exp(score_j / T),   T = 15 (one "amount-noise" step in score.ts)
```

The chosen edge carries `confidence = p_selected`; a **path** confidence is the product of
its edge confidences, documented as an independence approximation, never as a probability
of a real-world fact.

`alternatives` keeps the top 10 ranked candidates that lost, including their score
breakdown. The full candidate list is not stored in the result JSON (size); it is derivable
from the evidence store when the pages are kept.

### 5.2 Evidence

```ts
export const EvidenceRefSchema = z.object({
  id: z.string(),            // stable hash of requestKey + body
  requestKey: z.string(),    // "GET <origin><path>?<sorted params>" (no apikey), as requestKey()
  fetchedAt: z.string(),     // ISO
  status: z.number().int(),
  sha256: z.string(),        // of the stored (decompressed) body
  bytes: z.number().int(),
  uri: z.string(),           // explorer URL a human can open
});
```

`TraceEdge` and `Flag` gain `evidence: z.array(EvidenceRefSchema)`. `RunEvent` gains none;
evidence is written before the edge it supports.

Storage (SQLite, in `apps/server/src/db.ts`, as a new entry in `MIGRATIONS`):

```sql
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  body_gz BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL
);
CREATE INDEX evidence_request_key ON evidence (request_key);
```

Retention: evidence is pruned only by an explicit admin call (new CLI command
`fot evidence prune --older-than`), never automatically. Bodies are stored gzipped; the
API key never reaches the store because `requestKey` drops `apikey` and bodies are the
explorer's plain JSON (error envelopes included, so a failed lookup is auditable too).

### 5.3 Entity and label confidence

```ts
// LabelSchema additions
confidence: z.number().min(0).max(1).default(1),
lastVerifiedAt: z.string().nullable().default(null),

// New
export const EntitySchema = z.object({
  id: z.string(),                    // slug
  name: z.string(),
  category: LabelCategorySchema,
  addresses: z.array(z.object({
    chain: ChainIdSchema,
    address: z.string(),
    method: z.enum(["label", "cluster_funder", "cluster_exchange_deposit", "manual"]),
    confidence: z.number().min(0).max(1),
    evidence: z.array(EvidenceRefSchema),
  })),
  riskProfile: EntityRiskSchema.nullable(),
});

export const EntityRiskSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  factors: z.array(z.object({ id: z.string(), detail: z.string(), weight: z.number() })),
  exposedUsd: z.number(),
  unresolvedShare: z.number(),
  evidence: z.array(EvidenceRefSchema),
});
```

Labels stay address-keyed on disk (`packages/core/labels/*.json`) so existing files load
unchanged; `entity` becomes the join key for the new entity layer.

### 5.4 Cross-chain links

```ts
export const BridgeEventSchema = z.object({
  chain: ChainIdSchema,
  bridge: z.string(),        // "arbitrum-canonical", "polygon-pos", "wormhole", ...
  direction: z.enum(["deposit", "release"]),
  txHash: z.string(),
  logIndex: z.number().int().nullable(),
  asset: AssetSchema,
  amount: z.number(),
  sender: z.string(),
  recipient: z.string(),
  messageId: z.string().nullable(),
  timestamp: z.number().int(),
  evidence: EvidenceRefSchema,
});

export const CrossChainLinkSchema = z.object({
  from: BridgeEventSchema,
  to: BridgeEventSchema,
  confidence: z.number().min(0).max(1),
  matchedBy: z.enum(["message_id", "amount_time_recipient"]),
});
```

`TraceEdge` gains `crossChain: CrossChainLinkSchema.nullable()`; a bridge stop becomes
`stopReason: "bridge_unmatched"` (new enum member) when no link is found, kept expandable.

## 6. Component design

### 6.1 Evidence store

Recording happens in the transport layer, not in each provider: wrap the `Transport`
handed to providers with an `EvidenceTransport` (next to `RecordingTransport` in
`infra/transport.ts`). It writes `{requestKey, status, body}` through a new
`EvidenceStore` port (`infra/store.ts`), implemented by SQLite on the server and by an
in-memory store in tests. Demo replays do not record (the fixture is the evidence), and
`fixtures record` keeps its current format.

Failure to write evidence must fail the request: a conclusion without its raw response is
what this phase exists to prevent.

### 6.2 Confidence and alternatives in the engine

In `engine/trace.ts`, an expansion currently keeps `maxBranches` children and up to 30
dropped examples. Change:

1. compute the softmax over all scored candidates before truncation;
2. create children for the top `maxBranches` with their confidence;
3. attach the next 10 as `alternatives`;
4. leave `dropped`/`droppedByReason` as they are (they stay useful for dust and spoofs).

`provisional` analysis computes the same confidence from the live edge mirror, so
`AnalyzeProvisional` stays a subset of the final shape.

### 6.3 Entity resolution

New `packages/core/src/analysis/entity.ts`, rule-based and evidence-backed:

| Rule | Signal | Starting confidence |
|---|---|---|
| `label` | A bundled/local/OFAC label names the address | label confidence (1 for OFAC) |
| `cluster_funder` | Two addresses share an unlabeled funder (existing convergence) and one funds the other | 0.4 |
| `cluster_exchange_deposit` | An address receives from an exchange deposit address already linked to the entity | 0.5 |
| `manual` | An analyst confirmed the link | 1 |

Rules only *propose* membership; `manual` is the only one that can raise confidence to 1.
The entity list is therefore two-tiered: `proposed` and `confirmed`, and the API returns
both with their methods.

### 6.4 Cross-chain matching

New `packages/core/src/crosschain/`:

```
crosschain/
  adapter.ts        # BridgeAdapter interface + registry
  bridges/arbitrum-canonical.ts
  bridges/polygon-pos.ts
  bridges/wormhole.ts     (later)
  matcher.ts        # BridgeEvent -> CrossChainLink
```

`BridgeAdapter`:

```ts
interface BridgeAdapter {
  id: string;
  supports(chain: ChainId): boolean;
  /** Bridge events in a transaction, from the explorer rows the trace already fetched. */
  events(tx: TransactionContext, deps: AdapterDeps): Promise<BridgeEvent[]>;
  /** Candidate releases on the destination chain for one deposit (bounded pages, bounded time). */
  candidates(event: BridgeEvent, deps: AdapterDeps): Promise<BridgeEvent[]>;
}
```

`matcher.ts` scores a deposit/release pair: exact `messageId` → 0.99; otherwise amount within
the bridge's fee tolerance, recipient match, and a protocol time window; no match above
0.6 → `bridge_unmatched`. Both events keep their `EvidenceRef`.

Trace integration: the `entity` stop for a `bridge` label is replaced by an attempt to
match. A matched link creates the destination-chain edge as a child (with `crossChain`), and
the direction of travel on the destination chain follows the link. A bridge we cannot match
still stops the trace, now with a reason that says why.

Protocols, in order: Arbitrum canonical, Polygon PoS (both well documented, single-asset
mappings), then Wormhole/LayerZero (message-id keyed, assets more varied).

### 6.5 Macro warehouse and risk contribution

New `apps/server/src/warehouse.ts` plus tables (one migration step):

```sql
CREATE TABLE graph_nodes (
  chain TEXT NOT NULL, address TEXT NOT NULL, entity_id TEXT,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (chain, address)
);
CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
  chain TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL,
  asset_id TEXT NOT NULL, usd REAL, timestamp INTEGER NOT NULL,
  cross_chain_link_id TEXT
);
CREATE INDEX graph_edges_time ON graph_edges (timestamp);
```

Written incrementally at the end of every live run (demo replays excluded, as they are
synthetic).

Metrics over a time window and an entity set:

- value in/out and concentration (top counterparty share);
- risk-weighted exposure: USD that reaches a labeled `mixer`/`scam`/`sanctioned` at
  `hops <= k`;
- cross-chain and cross-asset spread: number of destination chains/assets reached;
- centrality: weighted in/out degree and a bounded PageRank.

Risk contribution is a decayed diffusion from confirmed high-risk entities:

```
r(v) = Σ_paths  Π_edges w(e) · decay^hops · seedRisk
```

with `decay` and per-category `seedRisk` calibrated on the ground-truth corpus (section 7),
not chosen by taste. The output is a ranked list with the paths that produced each score,
so a reviewer can audit a contribution rather than trust a number.

## 7. Validation

### 7.1 Ground truth

A corpus outside the unit tests (not committed as fixtures, or committed only as seeds and
expectations without raw bodies): `cases/<id>/case.json` with the seed, the expected path
(addresses and transfers), the expected entities, and the expected risk factors. Sources:
public incident write-ups, published enforcement actions, and the team's own reviewed
cases. Target 20–50 cases at the start, growing by one per review.

### 7.2 Metrics

| Metric | Definition | Measured on |
|---|---|---|
| Path recall | Expected transfers reached / expected transfers | Cases with a known path |
| Path precision | Reached transfers a reviewer confirms / reached | Sampled 30 edges per case |
| Entity precision/recall | Correct cluster memberships vs annotated | Cases with annotated entities |
| Cross-chain match precision | Correct links / links produced | Cases with a bridge hop |
| Flag precision | Flags a reviewer confirms / flags raised | All raised flags |
| Evidence verifiability | Conclusions whose `sha256` re-verifies and `uri` resolves | 100% sampled edges per release |
| Calibration | Brier score of edge confidence against reviewer labels | Cases with reviewed edges |

`scripts/evaluate.ts` runs the corpus through the current build with the offline fakes (or
a recorded capture) and prints the table plus the per-case failures.

### 7.3 The two scenarios

**A — anomalous asset migration.** Cases where funds move across chains or assets (a bridge
hop, a swap chain). Success: the cross-chain link is found with its evidence, the
destination path continues, and precision on the produced links clears the threshold agreed
before the phase.

**B — cross-asset risk propagation.** Cases where risky funds enter several assets and
spread. Success: direct and indirect exposure match the annotated values, the propagation
paths from confirmed risky entities are reproducible, and the flag precision clears its
threshold.

Thresholds are set once the corpus exists (phase M0) and are part of the acceptance of each
later phase; this document intentionally does not invent them.

## 8. API and UI surface

| Endpoint | Purpose | Phase |
|---|---|---|
| `GET /api/runs/:id/evidence/:evidenceId` | Raw stored response (JSON), for the report and the UI | M1 |
| `GET /api/runs/:id/evidence.json` | Evidence manifest for the run (hashes, sizes, URIs) | M1 |
| `POST /api/runs/:id/edges/:edgeId/review` | Confirm or reject one edge | M1 |
| `GET /api/entities`, `GET /api/entities/:id` | Entity list and profile | M2 |
| `POST /api/entities/:id/merge`, `/split` | Manual resolution | M2 |
| `POST /api/runs/:id/crosschain/:linkId/expand` | Continue on the destination chain | M3 |
| `GET /api/macro/summary`, `/api/macro/risk` | Windowed aggregates and contribution ranking | M4 |

UI: the edge detail panel gains a "why this edge" block (confidence, alternatives,
evidence links); a new Entities view lists proposed and confirmed entities; the report's
§5 gains an evidence appendix. Phone and accessibility rules in `CLAUDE.md` apply to every
new control.

## 9. Phases

Each phase is one or more issues with Scope, Acceptance and a planned commit message, per
the repository workflow.

| Phase | Scope | Deliverable | Rough size |
|---|---|---|---|
| M0 | Corpus format, `scripts/evaluate.ts`, baseline numbers on today's code | A metrics table we can improve against | 1–2 weeks |
| M1 | Evidence store, edge confidence, alternatives, review, evidence API | Every claim is auditable | 3–4 weeks |
| M2 | Label confidence, entity layer, clustering rules, entity API and view | Anomalous-entity list, tiered | 4–5 weeks |
| M3 | Bridge adapter interface, two adapters, matcher, trace continuation | Cross-chain path PoC | 5–7 weeks |
| M4 | Warehouse, metrics, diffusion, macro API and view | Macro contribution, calibrated | 5–7 weeks |

M0 and M1 are prerequisites for everything else: without a measured baseline and without
auditable evidence, later phases cannot be evaluated.

## 10. Risks and open questions

- **Data coverage dominates accuracy.** Free Etherscan is 3 requests/s and the listing cap
  is `EXPLORER_MAX_PAGES` (2 by default). Deep and macro analysis need paid tiers or a
  self-hosted indexer; that is a budget decision, not a code one.
- **Label licensing.** Commercial labels (Chainalysis, TRM, Elliptic) are costly and carry
  terms of use; self-built labels need a verification workflow. The repository rule that
  every bundled label carries a verified `source` already points the right way.
- **Cross-chain scope.** Every bridge is a new adapter with its own event shapes and fee
  rules; Wormhole/LayerZero-style message bridges are substantially harder than canonical
  bridges. Start narrow.
- **False positives are inherent.** Account-model attribution cannot be proven from chain
  data. Confidence and alternatives make the uncertainty visible; they do not remove it.
- **Legal wording.** Outputs must stay "lead / risk indicator", with human review before
  any entity-level determination; the report template should say so explicitly.
- **Open:** retention period and hosting for evidence bodies; whether entity IDs are
  global or per deployment; whether macro aggregation runs on a schedule or on demand.

## 11. Out of scope

- Automated sanctions determination or filing.
- Off-chain (exchange ledger, court order) data integration.
- Real-time streaming ingestion.
- Machine-learned selection replacing the heuristic scorer; the corpus built in M0 makes
  that possible later, but it is not part of this design.
