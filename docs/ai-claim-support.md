# Claim-support audit

CzituchBot treats claim support as a first-class validation artifact, separate from answer completeness and gold-fact correctness.

## Unit of evaluation

The audit unit is one atomic claim paired with one cited source span. The model may inspect the request's source pool to locate a candidate citation, but the final local checks bind the claim to one selected source and verify the exact quote plus a bounded same-source context. A different source cannot compensate for a missing or insufficient citation. The deterministic verifier is the authority for acceptance; the model's `supported` flag is not sufficient by itself.

## Per-claim verdicts

- `entailed`: the exact cited span passes local evidence verification.
- `partial`: the cited quote and bounded same-source context or a validated paraphrase support the claim, but the match is not an exact-span pass.
- `unsupported`: the cited span fails support checks or a hard overclaim guard fires.
- `contradicted`: the cited span conflicts with the claim on a checked hard fact such as negation, quantity, time, or event relation.
- `unverifiable`: the source ID or exact quote cannot be verified.

Every record retains the claim, the selected source ID, the exact quote, bounded context for diagnosis, model/local verdicts, support mode, reason, and any overclaim warnings. The overclaim detector examines the exact cited span, not neighboring sentences, so an unrelated hedge or qualifier cannot change this claim's label. These records are attached to validator diagnostics as `claimSupport`.

## Overclaim checks

The current conservative deterministic checks flag:
- correlation/association rewritten as causation;
- a hedged statement rewritten as an absolute;
- an “up to” / maximum qualifier removed from a numeric result;
- unsupported absolute or scope quantifiers such as “all”, “most”, “only”, “always”, and “never”;
- an older dated source presented as current (warning).

The first four are hard failures and route the answer into repair; a stale-source/currentness signal is recorded as a warning because it needs more context to avoid false positives. These heuristics complement, rather than replace, the existing negation, numeric, temporal, entity, and causal validators.

## Metrics

The live benchmark emits:
- `claimSupportPassRate`: fraction of claim-citation pairs labeled `entailed`;
- `claimSupportUsableRate`: fraction labeled `entailed` or `partial`;
- `claimSupport.verdictCounts` and `claimSupport.overclaimCounts` for backwards compatibility;
- `claimSupport.claimSourceVerdictCounts`, a normalized citation-level taxonomy: `supported`, `partial`, `contradicted`, `not_enough_evidence`, and `unsupported_by_cited_source`;
- per-claim audit records including both the legacy `verdict` and normalized `claimSourceVerdict` for regression diagnosis.

The strict pass rate intentionally does not silently count partial/contextual matches as exact citation support. It is independent of `completenessAccuracy` and the manually curated factual gold score.

## Validation

Run the offline suite with `npm test`. The live benchmark is a separate, quota-consuming production-pipeline check and should be run only after the deterministic regression suite passes and provider quotas are available.
