# Risk case corpus

Annotated cases used to measure the engine (design: [risk-platform.md](../../../docs/design/risk-platform.md),
"Validation"). Nothing here is recorded from an explorer: a case holds the seed, what a
reviewer confirmed the trace reaches, and the risk factors it should raise. The evaluation
runs the engine offline against the case.

## Layout

```
corpora/
  <case-id>/case.json     one case; the directory name equals the case id
  README.md
```

`case.json` is validated by `packages/core/src/eval/corpus.ts`. A case that fails validation
names its file and the offending field, for example:

```
corpora/bad/case.json: chain: Invalid input: expected "ethereum" | "polygon" | ...
```

## Format

| Field | Meaning |
|---|---|
| `version` | `1` |
| `id` | kebab-case; must equal the directory name |
| `title` | One line for the metrics report |
| `scenario` | `asset_migration` or `risk_propagation`; the two validation scenarios |
| `chain`, `direction` | The run parameters the case is traced with |
| `seeds` | 1–20 `{id, kind, value}` entries, validated against the chain's format |
| `expected.edges` | Transfers a reviewer confirmed are on the path: `from`, `to`, and optional `txHash`, `assetId`, `amount` |
| `expected.entities` | Entities the trace should expose: `id`, `category`, and one or more chain addresses |
| `expected.riskFactors` | Flag ids (from `analysis/flags.ts`) the run should raise |
| `annotations.reviewedBy`, `reviewedAt` | Who reviewed the case and when (`YYYY-MM-DD`) |
| `annotations.sources` | Where the case comes from: `kind`, optional `url`, optional `note` |

## Rules

- **No raw explorer responses.** A case is an annotation. Keys such as `raw`, `body`,
  `response` or `payload` are rejected at any depth, and a case file above 256 KB is
  rejected outright. Captures belong in `test/fixtures/`, and recordings in `fixtures/demo/`.
- **Only confirmed facts.** List a transfer or an entity when a reviewer checked it against
  the chain. An ambiguous hop is described in the review notes, not in `expected`.
- **Risk factors are flag ids.** `mixer_direct`, `scam_indirect`, `sanctioned_exposure` and
  the rest; an unknown id fails validation.
- **Addresses are real formats.** On Ethereum, Polygon and Arbitrum addresses are 20-byte
  hex and transaction hashes are 32-byte hex; on TRON, `T`-prefixed base58 addresses and
  64-hex transaction hashes. The loader rejects anything else, so a typo cannot reach a case.

## Annotation and review

1. An analyst picks a case from an allowed source and writes the seed plus what they
   confirmed while tracing it by hand.
2. A second reviewer re-checks every expected edge, entity and risk factor against the chain
   and records their name in `reviewedBy`.
3. Both names belong in the pull request; a case is merged only with the second review done.
4. When a later engine change alters the expected result for a reviewed case, the case is
   re-reviewed rather than edited to match the new output.

Allowed source classes (`annotations.sources[].kind`): `incident_report` (a published
post-mortem of a hack, fraud or sanctioned movement), `enforcement_action` (a court or
regulator document naming addresses) and `internal_review` (a case our own team traced).
Unverified social posts and unattributed screenshots are not sources.

The three `sample-*` cases are synthetic format examples; replace them as soon as the first
reviewed case lands.

## Metrics registry

`fot evaluate` reports these ids (design doc §7.2). They are stable: a later phase adds
metrics, it does not rename these.

| Id | Definition |
|---|---|
| `path_recall` | Expected transfers reached, over expected transfers, averaged across cases |
| `path_precision` | Reached transfers a reviewer confirms, over reached transfers (sample of 30 edges per case) |
| `entity_precision` | Correct entity memberships produced, over memberships produced |
| `entity_recall` | Correct entity memberships produced, over annotated memberships |
| `crosschain_match_precision` | Correct cross-chain links, over links produced |
| `flag_precision` | Flags a reviewer confirms, over flags raised |
| `evidence_verifiability` | Conclusions whose stored response re-hashes and whose URI resolves, over sampled conclusions |
| `confidence_brier` | Mean squared error of edge confidence against the reviewer's 0/1 label |

## Adding a case

1. Create `corpora/<case-id>/case.json` (copy a sample and replace every value).
2. Run `bun test packages/core/test/corpus.test.ts`; the loader must accept it.
3. Run `fot evaluate` (once issue #2 lands) and record the result in the pull request.
