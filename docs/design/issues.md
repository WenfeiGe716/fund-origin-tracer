# Issue breakdown: risk-analysis platform

Companion to [risk-platform.md](risk-platform.md). One issue per plan step, in the
repository's issue style: a commit-style title, Scope, an Acceptance checklist, and the
planned commit message. Each issue names the test that proves each acceptance item.

These are tracked as issues #1–#12 on GitHub, one per milestone below; the `Depends on` line
gives the real ordering.

| Milestone | Issues |
|---|---|
| Phase 1 — Measurement baseline | [#1](https://github.com/WenfeiGe716/fund-origin-tracer/issues/1), [#2](https://github.com/WenfeiGe716/fund-origin-tracer/issues/2) |
| Phase 2 — Auditable evidence | [#3](https://github.com/WenfeiGe716/fund-origin-tracer/issues/3), [#4](https://github.com/WenfeiGe716/fund-origin-tracer/issues/4), [#5](https://github.com/WenfeiGe716/fund-origin-tracer/issues/5) |
| Phase 3 — Entity layer | [#6](https://github.com/WenfeiGe716/fund-origin-tracer/issues/6), [#7](https://github.com/WenfeiGe716/fund-origin-tracer/issues/7), [#8](https://github.com/WenfeiGe716/fund-origin-tracer/issues/8) |
| Phase 4 — Cross-chain paths | [#9](https://github.com/WenfeiGe716/fund-origin-tracer/issues/9), [#10](https://github.com/WenfeiGe716/fund-origin-tracer/issues/10) |
| Phase 5 — Macro risk contribution | [#11](https://github.com/WenfeiGe716/fund-origin-tracer/issues/11), [#12](https://github.com/WenfeiGe716/fund-origin-tracer/issues/12) |

---

## 1. `test(core): define the annotated risk case corpus` — [#1](https://github.com/WenfeiGe716/fund-origin-tracer/issues/1)

**Milestone:** Phase 1 — Measurement baseline  
**Depends on:** —

**Scope**

- Define the corpus format from the design doc §7.1: one directory per case with the seed,
  the expected path, the expected entities and the expected risk factors, and no raw
  explorer bodies (those stay out of the repository).
- Put the loader in `packages/core/test/helpers/` (offline, as the testing policy requires)
  and the corpus itself in `test/corpora/` with a short README on how a case is added.
- Document the metrics registry (design doc §7.2) so later phases report against fixed names.

**Acceptance**

- [ ] `packages/core/test/corpus.test.ts` loads a three-case sample corpus and rejects a
      malformed case with a message naming the file and field.
- [ ] The corpus README states the annotation rules, who reviews a case, and the source
      classes allowed (public incident write-ups, enforcement actions, reviewed internal cases).
- [ ] No case file carries a raw explorer response; oversized bodies are excluded by a test.

**Planned commit**

```
test(core): define the annotated risk case corpus

Refs #1
```

---

## 2. `feat(cli): add an evaluate command reporting corpus metrics` — [#2](https://github.com/WenfeiGe716/fund-origin-tracer/issues/2)

**Milestone:** Phase 1 — Measurement baseline  
**Depends on:** 1

**Scope**

- New `apps/cli/src/commands/evaluate.ts`, registered like the existing commands in
  `cli.ts`, running the corpus through the engine with the offline fakes and printing the
  metrics from design doc §7.2: path recall, path precision (reviewed sample), entity
  precision/recall, cross-chain match precision, flag precision, evidence verifiability,
  and the Brier score of edge confidence.
- Output is a table plus one line per failing case, and a `--json` flag for machine
  consumption.
- Record the baseline numbers for today's engine in `docs/design/baseline.md`.

**Acceptance**

- [ ] `apps/cli/test/evaluate.test.ts` runs the command over the sample corpus and asserts
      the metric names and the failure listing.
- [ ] The command makes no network request (a transport that throws is installed by the test).
- [ ] `docs/design/baseline.md` reports the first measured numbers with the date and the
      corpus revision they were measured on.

**Planned commit**

```
feat(cli): add an evaluate command reporting corpus metrics

Refs #2
```

---

## 3. `feat(core): record raw explorer responses as evidence` — [#3](https://github.com/WenfeiGe716/fund-origin-tracer/issues/3)

**Milestone:** Phase 2 — Auditable evidence  
**Depends on:** —

**Scope**

- `EvidenceRefSchema` in `schema.ts` (design doc §5.2) and an `EvidenceStore` port in
  `infra/store.ts` with an in-memory implementation for tests.
- `EvidenceTransport` in `infra/transport.ts`, next to `RecordingTransport`, wrapping the
  transport handed to providers; a failed write fails the request.
- `trace.ts` and `flags.ts` attach evidence references to edges and flags.
- `apps/server/src/db.ts` gains the `evidence` table as a new `MIGRATIONS` entry (gzipped
  body, SHA-256, byte count, request key). Demo replays do not record.

**Acceptance**

- [ ] `packages/core/test/evidence.test.ts` proves the request key carries no `apikey`, the
      stored body re-hashes to its `sha256`, and a store failure surfaces as a request error.
- [ ] `apps/server/test/evidence-db.test.ts` migrates an existing database and round-trips a
      compressed body.
- [ ] Every edge of a live run carries at least one evidence reference (asserted in the
      engine test fixture run).

**Planned commit**

```
feat(core): record raw explorer responses as evidence

Refs #3
```

---

## 4. `feat(core): score edge confidence and retain losing candidates` — [#4](https://github.com/WenfeiGe716/fund-origin-tracer/issues/4)

**Milestone:** Phase 2 — Auditable evidence  
**Depends on:** 3

**Scope**

- Softmax over the scored candidates of one expansion (design doc §5.1), `confidence` on
  `TraceEdge`, and up to ten `alternatives` with their scores.
- Path confidence as the product of edge confidences, computed in `analysis/` and labelled
  an independence approximation in `docs/methodology.md`.
- Provisional analysis computes the same shape from the live mirror.
- The web edge panel shows confidence, the alternatives and their evidence links.

**Acceptance**

- [ ] `packages/core/test/score.test.ts` covers ties, a single candidate (confidence 1), and
      an all-unpriced expansion (confidence null), each with a fixed expected value.
- [ ] A stored v1 result still loads and renders (confidence null, no alternatives), proven
      by `apps/web/test/run-state.test.ts` and a server round-trip test.
- [ ] `docs/methodology.md` documents the formula, the temperature and the caveat.

**Planned commit**

```
feat(core): score edge confidence and retain losing candidates

Refs #4
```

---

## 5. `feat(server): expose evidence and edge review endpoints` — [#5](https://github.com/WenfeiGe716/fund-origin-tracer/issues/5)

**Milestone:** Phase 2 — Auditable evidence  
**Depends on:** 3, 4

**Scope**

- `GET /api/runs/:id/evidence/:evidenceId` (raw stored body), `GET /api/runs/:id/evidence.json`
  (manifest), and `POST /api/runs/:id/edges/:edgeId/review` (confirm or reject, stored beside
  the run, never mutating `result_json`).
- The report gains an evidence appendix; the workspace edge panel links each conclusion to
  its evidence and its review state.
- `DEMO_ONLY` refuses the review endpoint like the other mutating routes.

**Acceptance**

- [ ] `apps/server/test/app.test.ts` covers 200/404 on the evidence route and 403 under
      `DEMO_ONLY` on review.
- [ ] A reviewed edge appears as confirmed in the export and in the report appendix.
- [ ] The smoke suite opens an edge's evidence in the browser and returns without console errors.

**Planned commit**

```
feat(server): expose evidence and edge review endpoints

Refs #5
```

---

## 6. `feat(core): add label confidence and verification timestamps` — [#6](https://github.com/WenfeiGe716/fund-origin-tracer/issues/6)

**Milestone:** Phase 3 — Entity layer  
**Depends on:** —

**Scope**

- `LabelSchema` gains `confidence` and `lastVerifiedAt` (design doc §5.3); `labels/files.ts`
  accepts them and rejects out-of-range values at load.
- `LabelRegistry` keeps every label for an address instead of one, ordered OFAC first, then
  by confidence.
- `docs/labels.md` documents the fields and what `lastVerifiedAt` means.

**Acceptance**

- [ ] `packages/core/test/labels.test.ts` covers ordering, default confidence (1) and a
      rejected confidence outside 0–1.
- [ ] Older label files without the new fields still load, proven by the bundled-file test.

**Planned commit**

```
feat(core): add label confidence and verification timestamps

Refs #6
```

---

## 7. `feat(core): cluster addresses into entities with evidence` — [#7](https://github.com/WenfeiGe716/fund-origin-tracer/issues/7)

**Milestone:** Phase 3 — Entity layer  
**Depends on:** 6, 4

**Scope**

- `EntitySchema` and `EntityRiskSchema` in `schema.ts`; `analysis/entity.ts` implements the
  four rules from design doc §6.3 (`label`, `cluster_funder`, `cluster_exchange_deposit`,
  `manual`) with their starting confidences and their evidence references.
- Entity risk profile built from the existing exposure, convergences and flags, aggregated
  per entity rather than per address.
- `manual` is the only rule that reaches confidence 1; proposals never overwrite a reviewed
  membership.

**Acceptance**

- [ ] `packages/core/test/entity.test.ts` covers each rule, the proposed-versus-confirmed
      separation, and a merge that cannot lower a confirmed confidence.
- [ ] Entity risk matches the summed exposure of its addresses in a fixture run.

**Planned commit**

```
feat(core): cluster addresses into entities with evidence

Refs #7
```

---

## 8. `feat(web): add the entity list and entity profile views` — [#8](https://github.com/WenfeiGe716/fund-origin-tracer/issues/8)

**Milestone:** Phase 3 — Entity layer  
**Depends on:** 7

**Scope**

- `GET /api/entities` and `GET /api/entities/:id` in `apps/server/src/app.ts`.
- A new Entities view: proposed and confirmed entities, filters by category, risk and
  chain; the profile shows addresses, methods, evidence and the risk factors.
- Merge and split actions for confirmed entities.

**Acceptance**

- [ ] The page keeps one `h1` and no skipped heading level; the phone pass keeps every
      control at least 44 × 44 px (extend `smallTargets` to the new view).
- [ ] Merge and split survive a reload and show in the evidence history.
- [ ] The smoke suite opens an entity profile, merges two proposals and asserts the result.

**Planned commit**

```
feat(web): add the entity list and entity profile views

Refs #8
```

---

## 9. `feat(core): add the bridge adapter interface and the Arbitrum canonical adapter` — [#9](https://github.com/WenfeiGe716/fund-origin-tracer/issues/9)

**Milestone:** Phase 4 — Cross-chain paths  
**Depends on:** 3

**Scope**

- `packages/core/src/crosschain/adapter.ts` with the `BridgeAdapter` interface from design
  doc §6.4, plus `bridges/arbitrum-canonical.ts`.
- `BridgeEventSchema` in `schema.ts`; events carry their evidence reference.
- Adapter tests run against captured event rows in `packages/core/test/fixtures/crosschain/`.

**Acceptance**

- [ ] `packages/core/test/crosschain-arbitrum.test.ts` extracts deposit and release events
      from captured transactions with the expected asset, amount and recipient.
- [ ] A transaction with no bridge event yields an empty list, not an error.

**Planned commit**

```
feat(core): add the bridge adapter interface and the Arbitrum canonical adapter

Refs #9
```

---

## 10. `feat(core): match bridge events and continue traces across chains` — [#10](https://github.com/WenfeiGe716/fund-origin-tracer/issues/10)

**Milestone:** Phase 4 — Cross-chain paths  
**Depends on:** 9, 4

**Scope**

- `crosschain/matcher.ts`: message-id match first, otherwise amount tolerance plus recipient
  plus protocol time window; below 0.6 no link (design doc §6.4).
- `CrossChainLinkSchema`; `TraceEdge.crossChain`; a bridge stop becomes `bridge_unmatched`
  (new stop reason, expandable), so an unmatched bridge no longer looks like a plain entity stop.
- The engine continues on the destination chain when a link matches, with the linked edge
  carrying the link and its confidence.

**Acceptance**

- [ ] `packages/core/test/crosschain-match.test.ts` covers an exact message-id match, a
      fee-adjusted amount match, an ambiguous pair below the threshold, and a link whose
      destination event is missing.
- [ ] A fixture run continues past a canonical bridge and reaches a destination-chain edge.
- [ ] `docs/methodology.md` gains a cross-chain section with the matching rules and limits.

**Planned commit**

```
feat(core): match bridge events and continue traces across chains

Refs #10
```

---

## 11. `feat(server): persist run graphs into a macro warehouse` — [#11](https://github.com/WenfeiGe716/fund-origin-tracer/issues/11)

**Milestone:** Phase 5 — Macro risk contribution  
**Depends on:** 10, 7

**Scope**

- `apps/server/src/warehouse.ts` and the `graph_nodes` / `graph_edges` tables from design
  doc §6.5, written at the end of every live run; demo replays are excluded.
- Windowed aggregation queries: value in/out, concentration, risk-weighted exposure,
  cross-chain and cross-asset spread, weighted centrality.
- `GET /api/macro/summary` and `/api/macro/risk`.

**Acceptance**

- [ ] `apps/server/test/warehouse.test.ts` writes two runs, reads a window, and proves a
      demo run is not written.
- [ ] Deleting a run leaves the warehouse rows intact (aggregates are not run-scoped).
- [ ] The API returns the documented shape with an empty warehouse.

**Planned commit**

```
feat(server): persist run graphs into a macro warehouse

Refs #11
```

---

## 12. `feat(core): compute macro risk contribution with a calibrated diffusion` — [#12](https://github.com/WenfeiGe716/fund-origin-tracer/issues/12)

**Milestone:** Phase 5 — Macro risk contribution  
**Depends on:** 11, 2

**Scope**

- The decayed diffusion from design doc §6.5 with `decay` and per-category `seedRisk`
  calibrated on the corpus, not hand-picked.
- Each score returns the paths that produced it, so a reviewer can audit the contribution.
- The macro view ranks entities and shows a contribution's paths.

**Acceptance**

- [ ] `packages/core/test/macro.test.ts` covers an isolated high-risk entity, a two-hop
      spread, and a graph with no risky seed (all scores zero).
- [ ] Calibration parameters are read from the corpus run and written into
      `docs/design/baseline.md` with the measured Brier score.
- [ ] The two validation scenarios in design doc §7.3 are run through `fot evaluate` and
      their results recorded in `docs/design/baseline.md`.

**Planned commit**

```
feat(core): compute macro risk contribution with a calibrated diffusion

Refs #12
```
