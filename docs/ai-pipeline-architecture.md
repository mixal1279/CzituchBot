# AI pipeline architecture

This document defines the stage boundaries for the CzituchBot factual-answer pipeline. The boundaries are intentional: a retrieval failure, a generation failure, and an evidence-validation failure must not collapse into one generic "hallucination" result.

## Stage contracts

1. **Request planning** — normalize and route the question; derive an answer plan and the retrieval queries required by its intent. Planning may declare required answer slots, but it is not evidence that those slots have been answered.
2. **Retrieval** — collect source blocks with stable source IDs and metadata. Query planning and source ranking are retrieval concerns. Source count, query success, or a relevant page title alone does not prove a claim.
3. **Evidence policy** — assess source quality/relevance and decide whether external evidence and a validator are required. Parse the same source-content boundaries for evidence scoring and claim validation; titles and URLs must not silently become evidence text.
4. **Generation** — draft only the user-facing answer. Internal evidence-candidate labels are removed before deterministic guards, validation, repair, or delivery. Logs record the contract violation, never a fragment of generated answer text.
5. **Claim validation** — split the answer into atomic claims; require known source IDs and a contiguous quote from the cited source; bind short infobox fields to the nearby claimed entity; check names, numbers, units, temporal signals, negation, event/action conflicts, and causal relations. A purpose clause or stated capability is not proof that its intended outcome occurred.
6. **Claim-to-answer coverage** — independently check that the set of validated claims covers every material answer sentence. Claims may jointly cover a sentence only when each contributing claim has a meaningful lexical and semantic connection to that sentence; aggregate name overlap is not enough.
7. **Answer completeness and deterministic guards** — evaluate the answer against the planned slots and apply hard factual/format guards. This stage answers "did we answer the question?" and does not replace the claim-support check.
8. **Bounded repair** — repair only when the shared request deadline leaves enough time for generation and revalidation. Provider fallbacks stay inside the shared budget. A repaired answer goes through claim validation and deterministic guards again; repair never grants an exemption from the original checks.
9. **Finalization** — deliver an answer only when the applicable gates pass. On rejection, inconclusive validation, or provider unavailability, abstain or return the explicitly configured unverified state rather than inventing facts.

## Evaluation and diagnostics

Keep these dimensions separate in tests and benchmark reports:

- **Retrieval/transport:** search calls, source availability, source count, HTTP failures, timeouts, and provider quota.
- **Answer completeness:** planned slots and multi-clause coverage.
- **Claim support:** exact quote verification, source-ID validity, per-claim verdict, and overclaim categories.
- **Semantic consistency:** names/entities, numbers and units, polarity/negation, event type, language alignment, and cause-versus-purpose.
- **Pipeline outcome:** accepted, evidence rejection, semantic rejection, abstention, provider quota, provider timeout, budget exhaustion, and unexpected pipeline error.

Offline regression tests are the fast gate for deterministic behavior. The live benchmark is a separate, manually triggered integration check because it consumes provider/search quota and can fail for reasons unrelated to factual correctness. A passing offline suite is necessary but does not, by itself, establish live provider health or zero hallucination risk.

## Change rule

When changing a guard, add both a positive and a negative regression case. Prefer a narrow rule tied to the specific failure mode over globally lowering thresholds. If a heuristic cannot reliably distinguish a fact from a purpose clause, rhetorical negation, or a shared proper noun, it must not silently turn that ambiguity into a supported factual claim.
