# AI pipeline architecture

This document defines the stage boundaries for the CzituchBot factual-answer pipeline. The boundaries are intentional: a retrieval failure, a generation failure, and an evidence-validation failure must not collapse into one generic "hallucination" result.

## Stage contracts

1. **Request planning** — normalize and route the question; derive an answer plan and the retrieval queries required by its intent. Planning may declare required answer slots, but it is not evidence that those slots have been answered.
2. **Retrieval** — collect source blocks with stable source IDs and metadata. Query planning and source ranking are retrieval concerns. Source count, query success, or a relevant page title alone does not prove a claim. Tavily Search excerpts and Exa highlights are retained only as snippet metadata; only Tavily `raw_content`, Exa extracted `text`, or text returned by Tavily Extract may become factual evidence. A basic snippet-only result returns empty evidence without spending a secondary-provider call; the request planner can use its next advanced query. An advanced snippet-only result may try secondary full-text extraction. In either case, snippets never become source-content blocks. The Tavily cache schema version is bumped when evidence semantics change so old snippet-bearing entries cannot bypass this rule.
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


## Conversation scope, concurrency, and diagnostics

Conversation history and verified user memory use a stable scope key:

`platform:channel:user-id`

- Twitch uses the IRC `user-id` tag, falling back to the normalized login when the tag is absent.
- YouTube uses `authorDetails.channelId`, falling back to the display name only when the API omits the stable ID.
- Kick uses the sender ID when supplied by the event, falling back to the sender name.
- Platform and channel components are normalized to lowercase. Platform user IDs retain their original case because provider IDs may be case-sensitive.
- The in-memory conversation history is bounded to 500 scopes and evicted by least-recent use. The LRU timestamp must use the same complete scope key as the history map.

The AI request queue is process-wide because it protects shared provider capacity: at most 3 active jobs and 20 queued jobs. A completed job transfers its slot directly to the next waiter; the active counter is not decremented during handoff. A full queue rejects the new request with `AI_QUEUE_FULL`, and a queued request or provider-state initialization expires after 15 seconds with `AI_QUEUE_TIMEOUT` so stale work cannot hold memory indefinitely.

Provider diagnostics use an allowlist of safe error fields. Request headers, request bodies, credentials, raw generated payloads, and provider response bodies are not serialized into logs. Error messages are redacted before logging.

## Platform coverage

The current repository has AI chat entry points for Twitch, YouTube, and Kick. Discord references in this codebase are outbound alert/social integrations; the package does not include a Discord gateway client or an AI message-ingress handler. Discord AI chat must therefore be treated as an unimplemented platform, not as a tested ingress path.

Public retrieval caches and provider quota/cooldown state are process-wide by design. They contain shared provider/public-data state, not per-user conversation history. Conversation history and verified memory must never use a nick-only key when a stable platform identity is available.

## Change rule

When changing a guard, add both a positive and a negative regression case. Prefer a narrow rule tied to the specific failure mode over globally lowering thresholds. If a heuristic cannot reliably distinguish a fact from a purpose clause, rhetorical negation, or a shared proper noun, it must not silently turn that ambiguity into a supported factual claim.
