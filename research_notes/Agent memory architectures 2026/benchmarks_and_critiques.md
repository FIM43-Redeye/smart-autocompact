# Empirical evidence on long-horizon LLM agent memory (as of Nov 2026): benchmarks, what helps, critiques

Method note: sources below were downloaded and read (full text or abstract page) unless marked "SNIPPET-ONLY". Fewer than planned could be opened; the already-read papers (2606.23525, 2608.11242, 2606.22528, 2606.11213) are only mentioned in Gaps. Some pages in the download directory pre-existed from another researcher; I only used ones I opened and read. Effort budget was limited, so coverage of 2026 coding-specific benchmarks is partial.

## 1. Benchmarks: what they measure, flaws, top results

### Takeaway
Chat-recall benchmarks (LoCoMo, LongMemEval) are small, disputed, and routinely matched by full-context or plain-file baselines; the more relevant agent/task benchmarks (CL-Bench, AgentCL, SWE-ContextBench, LOCA-bench, LoopsBench) are newer, small, and mostly show memory gains that are narrow, noisy, or negative. No benchmark I found measures repeated compaction in a coding session.

### Cited Findings
- **LoCoMo**: QA over long synthetic two-speaker conversations. Zep's critique: conversations average ~16-26K tokens ("easily within the context window"), Category 5 unusable (missing ground truth), image-caption errors, speaker misattribution, ambiguous questions, no knowledge-update questions; Mem0's own paper had a full-context baseline at J ~73% vs Mem0's best ~68% (vendor-reported, Zep, 2025) — [Zep blog "Is Mem0 Really SOTA in Agent Memory?"](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) (page read; exact URL from memory, unverified)
- **Zep vs Mem0 dispute**: Zep alleges Mem0 gave both speakers the user role, passed timestamps in message text instead of `created_at`, and ran searches sequentially (inflating latency). Vendor-vs-vendor, no neutral replication found. Later vendor scores are not comparable: Mem0 states 92.5% LoCoMo, 94.4% LongMemEval, 64.1% BEAM-1M, 48.6% BEAM-10M "as of 2026" (vendor-reported, model/setup per its page) — [Mem0 benchmark guide](https://mem0.ai/blog/ai-memory-benchmarks). That page itself notes "several of these numbers are disputed by the vendors named next to them, and at least one vendor has published two different scores for itself."
- **Letta filesystem result (vendor-reported, Aug 12 2025, GPT-4o-mini)**: conversation history placed in files with grep/search_files/open tools scored 74.0% on LoCoMo vs Mem0's reported 68.5% for its best graph variant. Letta's own interpretation: "current memory benchmarks may not be very meaningful" and memory "is more about how agents manage context than the exact retrieval mechanism." Tool-call patterns were constrained by tool rules; single run, no CIs; Letta says it could not reproduce Mem0's MemGPT numbers — [Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- **MemoryAgentBench** (ICLR 2026; 4 competencies: accurate retrieval, test-time learning, long-range understanding, selective forgetting). Backbones mostly GPT-4o-mini / GPT-4.1-mini / Gemini-2.0-Flash / Claude-3.7-Sonnet (old, small). Findings: RAG wins on accurate retrieval; "Long-context models achieve the best performance on TTL and LRU"; all methods fail at selective forgetting (conflict resolution) — [arXiv 2507.05257](https://arxiv.org/pdf/2507.05257)
- **BEAM** ("Beyond a Million Tokens"): 100 conversations, 2,000 questions, up to 10M tokens; "even LLMs with 1M token context windows (with and without retrieval-augmentation) struggle as dialogues lengthen"; authors' LIGHT memory gives 3.5%-12.69% average gain over strongest baseline (authors' own system) — BEAM paper page read, arXiv ID not captured (title: "Beyond a Million Tokens: Benchmarking and Enhancing Long-Term Memory in LLMs").
- **LongMemEval**: top scores are saturating at vendor level (Mem0 94.4% vendor-reported above). Independent controlled data: see section 2 (MemDelta, StateMem). A LongMemEval-V2 leaderboard page exists (results updated Oct 29 2026; top subjects "AgentRunbook-C", "Codex") but I only saw the header, not methods — [LongMemEval-V2 listing](https://xiaowu0162.github.io/longmemeval-v2/) (page header only; treat as unverified).
- **MemBench / MemoryBench / StreamBench / LifelongAgentBench / MemoryArena**: MemoryBench (feedback-driven continual learning; abstract: "effectiveness and efficiency of state-of-the-art baselines are far from satisfying") and MemoryArena (interdependent multi-session agentic tasks; abstract only) were read at abstract level, no numbers extracted. MemBench and StreamBench: not opened.
- **Evo-Memory** (Google DeepMind + UIUC, arXiv 2511.20857, v2 May 18 2026): streaming task-stream benchmark, >10 memory modules, baseline ExpRAG and proposed ReMem. Not coding-specific. I read only the abstract-level material; ReMem's claimed BabyAI 0.92 (Gemini-2.5 Flash) is SNIPPET-ONLY / unverified — [arXiv 2511.20857](https://arxiv.org/abs/2511.20857)
- **SWE-Bench-CL** (Columbia, 2025): chronological per-repo streams from SWE-Bench Verified, FAISS semantic memory in a LangGraph agent, metrics for forgetting and forward/backward transfer. The paper presents a protocol; I found no full memory-on vs memory-off result in the text I read — [arXiv 2507.00014](https://arxiv.org/html/2507.00014v1)
- **SWE-ContextBench**: 1,100 base + 376 related tasks, 51 repos, 9 languages. On SWE-Bench Lite with Claude Sonnet 4.5 (99 related tasks; small n): No-Context 26.26% resolution; Oracle Summary 34.34%; Oracle full-trajectory Context 27.27%; Oracle Summary beats Free Summary (agent chooses) by 12.12 points; Oracle Context beats Free Context by 1.01. Cost: Free Context $0.98/instance vs No-Context $0.79 (+24%) vs Oracle Context $0.77. Authors' conclusion: "concise summaries are highly effective when correctly selected, but misleading when irrelevant"; "unfiltered or incorrectly selected context provides limited or negative benefits" — SWE-ContextBench paper page read (arXiv ID not captured). Gain depends on a retrieval oracle; free retrieval gets much less.
- **CL-Bench** (arXiv 2606.05661, Jun 2026): six expert-validated domains (incl. codebase adaptation); frontier models Claude Opus 4.7, Sonnet 4.6, Gemini 3.1 Pro/3 Flash, GPT-5.4; 5 runs per eval, 95% CIs. Best system: full-context ICL with Sonnet 4.6, normalized reward 22.3%, normalized gain 25.4%, $30.4/run. Mem0 (GPT-5.4) gain 20.2% vs ICL GPT-5.4 20.1%; ICL Notepad Sonnet 4.6 gain 18.2% (reward 3.5%); ACE (GPT-5.4) gain 8.6% at $62.8; Claude Code (Sonnet 4.6) gain 23.9% at $38.6; Opus 4.7 ICL gain 19.5% at $49.6. Authors: "naive ICL outperforms dedicated memory architectures on most tasks"; "Accumulated state frequently hurts rather than helps: memory modules introduce spurious generalizations and stale beliefs." Codebase task showed "minimal gain throughout with both curves overlapping." Sequences are only "tens of instances" — [arXiv 2606.05661](https://arxiv.org/pdf/2606.05661)
- **AgentCL** (arXiv 2606.02461, Jun 2026): compositional vs naive task streams (coding via CodeEval-Pro, deep research, reasoning); default model Qwen3.5-35B-A3B (small open-weight), 3 runs for coding. Finding: "naive streams offer limited ability to distinguish memory designs"; memory methods "frequently induce cognitive interference or performance degradation in naive and held-out settings"; on naive coding stream, "most memory methods perform slightly below ReAct"; held-out coding gains vs memoryless of -4.2, -5.0, -0.8 for three methods; a topically similar but semantically incompatible retrieved task hurt in a case study — [arXiv 2606.02461](https://arxiv.org/html/2606.02461v2)
- **LOCA-bench** (long-context agents; controlled environment growth 8K-256K; 15 seed tasks x5 seeds; Claude-4.5-Opus, GPT-5.2-Medium, Gemini-3-Flash + open models): Opus accuracy 96.0 / 84.0 / 84.0 / 65.3 / 45.3 / 34.0 / 14.7 at 8K/16K/32K/64K/96K/128K/256K (avg 68.1); GPT-5.2-Medium 72.0 / 70.7 / 60.0 / 52.0 / 44.0 / 38.7 / 21.3 (avg 51.2). "The gap begins to open around 32K." Context-engineering at 128K: programmatic tool calling "consistently strong across all models: it significantly improves accuracy while reducing trajectory length"; paper abstract: "advanced context management techniques can substantially improve the overall success rate" (per-technique table numbers not extracted). Models: late-2025 frontier — LOCA-bench paper page read (arXiv ID not captured).
- **LoopsBench** (Microsoft; 112 long-horizon coding tasks as dependency DAGs, 8 languages): best config Opus-4.7 + Claude Code + outer continuation resolves 25.00% of tasks; "regression events remain visible across the evaluated loop profiles" — LoopsBench page read (arXiv ID not captured). Measures loop/continuation, not memory per se.
- **Compaction-quality benchmark: Factory.ai (vendor-reported, Dec 16 2025)**: probe-based (recall, artifact, continuation, decision), GPT-5.2 as judge, 36,611 production messages, same prefixes compressed by each method. Overall scores: Factory 3.70, Anthropic 3.44, OpenAI 3.35 (0-5). Accuracy 4.04/3.74/3.43; context awareness 4.01/3.56/3.64; artifact trail 2.45/2.33/2.19. Compression 98.6% (Factory), 98.7% (Anthropic), 99.3% (OpenAI /responses/compact). Factory: "Artifact tracking remains an unsolved problem" (all <2.5/5). Caveats: vendor evaluating own product; no variance/CIs reported ("differences consistent"); probes measure recall after a single compression, not end-task success; the Anthropic/OpenAI arms were fed prefixes via API, not their in-product harness — [Factory](https://factory.ai/news/evaluating-compression)
- **Long-horizon software benchmarks / METR / SWE-bench Pro / MLE-bench**: not researched in depth in this pass; no numbers collected (see Gaps).

### Inferences
- For a coding agent, CL-Bench/SWE-ContextBench/AgentCL are the closest proxies and all three show that benefit is conditional on retrieval precision and task relatedness; none shows a structured memory layer beating a full-context baseline by a large, replicated margin.
- Factory's artifact-trail score (~2.4/5) is the single most coding-relevant measured weakness of summaries, and supports keeping a file/artifact ledger outside the summary (design inference, not tested by Factory).

### Gaps
- No independent replication of Factory's results found. No head-to-head benchmark of in-product Claude Code / Codex compaction on end-task success.
- MemBench, StreamBench, LifelongAgentBench, SWE-bench Pro, METR time horizons, MLE-bench not opened.

## 2. Simple baselines vs elaborate systems; observation masking vs summarization

### Takeaway
Plain retrieval, full context, or observation masking match elaborate systems in most controlled comparisons; elaborate systems win mainly when history exceeds the usable window (BEAM-scale, multi-month) or on state-tracking, and even then evidence is single-lab.

### Cited Findings
- **The Complexity Trap** (JetBrains Research/TUM, NeurIPS 2025 DL workshop; SWE-agent, SWE-bench Verified, 250-turn limit, 95% bootstrap CIs; models Qwen3-Coder 480B, Qwen3-32B, Gemini 2.5 Flash): observation masking "halves cost relative to the Raw Agent while matching, and sometimes slightly exceeding, the solve rate of LLM-Summary." Qwen3-Coder 480B: masking 54.8% (-52.7% cost) vs LLM-Summary 53.8% (-50.4%) vs raw ~52.2% (implied). Gemini 2.5 Flash non-thinking: masking 35.6% vs summary 36.0%; Gemini thinking: masking 36.4 vs summary 31.4. Window M=10 observations. LLM-Summary causes "trajectory elongation" (Gemini Flash: 52 vs 44 turns) and summary calls cost up to 7.2% of instance cost, with poor cache reuse. Masking window must be re-tuned per scaffold (OpenHands: SWE-agent's M=10 "degrades drastically"; tuned M=58; 50-instance slice only). Hybrid (summary deferred to N=43, then masking) cuts cost 7%/11% vs masking/summary, +2.6 points on a 50-instance subset. Observations ~84% of an average SWE-agent turn (SWE-bench Lite-50 preliminary). Caveat: no Claude/GPT-5 models; 2025-vintage models — [arXiv 2508.21433v3](https://arxiv.org/html/2508.21433v3)
- **MemDelta** (arXiv 2606.29914, Jun 2026; LongMemEval-S, 500 q, three model families incl. Sonnet; GPT-4o-mini headline): verbatim RAG 47.2% vs full-context 49.8% (p=0.34); ranking reverses by model — Gemini +14pp from full context, Sonnet +31pp from RAG "partly because it refuses 63% of full-context queries"; swapping only the embedder shifts accuracy +6.2pp (p=0.004); Mem0 beats MiniLM-RAG by +11pp (72.7 vs 61.4) but loses to cloud-embedding RAG by 1.2pp (72.7 vs 73.9); agent self-memory 42% < basic retrieval 47%; on 2 of 6 question types Mem0 matches cloud RAG (72.7 vs 73.9, p=1.0) at 50x cost. Authors call it a measurement paper; model versions not frontier-5.x — [arXiv 2606.29914](https://arxiv.org/html/2606.29914)
- **StateMemBench** (arXiv 2608.19652, Aug 2026; DeepSeek-V4-Flash, Qwen-3.5-9B, GPT-5.4-Nano): on LongMemEval best memory system 0.656 vs long-context baseline 0.666 on DeepSeek ("within a point"); Mem0 0.594. On state tracking, long-context scores only 0.149 (best GPT-5.4-Nano long-context 0.277); authors' StateMem 0.363 vs strongest same-backbone baseline 0.205; control attributes +15 to +32 of added points to "state structure rather than added context." Same authors propose the method (not independent) — [arXiv 2608.19652](https://arxiv.org/html/2608.19652)
- **Ground Truth First** (arXiv 2607.21962, Jul 2026; single independent author; judge claude-sonnet-5; 3 replicates; n=324 per cell): at 3 weeks of history a full-rendered-history baseline "tied or exceeded" tested memory systems; at 9 weeks "no judge-independent accuracy winner emerged between the layered system and reading the entire raw transcript, at roughly half the read cost for the layered system"; rankings invert with history length (budgeted curated-map memory recall of evicted content 96%->72%; provenance graph rises to 90%). Synthetic corpus, ~380 questions — [arXiv 2607.21962](https://arxiv.org/html/2607.21962v1)
- MemoryAgentBench: long-context models best on test-time learning and long-range understanding; RAG best on retrieval; all fail on selective forgetting (see Section 1).
- BEAM/Mem0-style benchmarks show memory pays off at 1M-10M tokens where raw history no longer fits (BEAM abstract); Mem0 vendor numbers drop to 64.1% (1M) and 48.6% (10M).
- "Anatomy of Agentic Memory" survey (abstract/intro read): benchmarks "underscaled relative to modern context windows," "complex memory systems are frequently tested in settings where simpler full-context or retrieval baselines suffice"; backbone-dependent accuracy; maintenance latency overhead — arXiv ID not captured.

### Inferences
- Crossover where memory machinery starts to win appears to sit at "history does not fit usable context" (roughly >1M tokens in BEAM; weeks of history in Ground Truth First), not at chat lengths of 20-120K tokens.
- For a coding agent the simplest defensible tier-1 is observation/tool-result masking with a tuned window, with summarization deferred; but the evidence is on SWE-bench-length (<~250 turn) trajectories with older models.

### Gaps
- No replication or 2026 follow-up of the Complexity Trap found in my searches (SNIPPET-level searching only; not exhaustive). No Claude 4.x/5.x or GPT-5.x result for masking vs summarization.

## 3. Context rot and when to compact

### Takeaway
Degradation with length is real, task- and model-dependent, and in agentic settings starts around 32K-64K tokens for 2025 frontier models; Anthropic claims its 4.6 models hold accuracy to 1M, but its own MRCR number is for retrieval, not agentic work. I found no data-backed "best compaction percentage."

### Cited Findings
- **Chroma "Context Rot"** (Jul 14 2025; Hong, Troynikov, Huber; 18 LLMs incl. Claude Sonnet 4, GPT-4.1, Gemini 2.5, Qwen3): non-uniform performance as input grows even on simple tasks; degradation grows faster as needle-question similarity falls; distractors hurt non-uniformly; "structural coherence consistently hurts model performance"; authors "do not explain the mechanisms." Needle position had no notable effect in their NIAH variant. Chroma is a vector-DB vendor with an interest in retrieval — [Chroma research](https://research.trychroma.com/context-rot)
- **LOCA-bench** (above): agentic tasks; accuracy at 8K -> 128K falls Opus 96->34, GPT-5.2-Medium 72->38.7; degradation visible by 32-64K (late 2025 models, task-specific).
- **Anthropic** (Mar 13 2026): 1M context GA for Opus 4.6/Sonnet 4.6, no long-context premium; "Opus 4.6 scores 78.3% on MRCR v2" (vendor-reported); claims "maintain accuracy across the full 1M window" and that "lossy summarization... no longer needed"; testimonials (e.g. "15% decrease in compaction events") are anecdotes — [Anthropic](https://claude.com/blog/1m-context-ga). Contradicting signals (SNIPPET-ONLY, unverified): a GitHub issue and blog report MRCR v2 8-needle ~93% at 256K vs ~76% at 1M; a blog claims Opus 4.7 regressed to 32.2% at 1M; a CodingFleet/Unblocked blog claims accuracy drops at 200K — [claude-code issue 35296](https://github.com/anthropics/claude-code/issues/35296).
- MemDelta: Sonnet refused 63% of full-context LongMemEval-S queries (~115K tokens) — a model-specific long-context failure mode.
- Complexity Trap: in 3 of 5 setups the most efficient (masked) strategy also had a higher solve rate than raw — "beyond a certain point, more context becomes a liability."

### Inferences
- A fraction-of-window trigger is not supported by data; evidence supports absolute-token thresholds that depend on task (32-64K onset in LOCA; 1M window does not remove it for agentic multi-step work, which is untested on 4.6+ models).

### Gaps
- No published measurement of optimal compaction point (% of window) for coding agents. No independent 2026 measurement of agentic degradation on Opus 4.6/4.7, Sonnet 4.6, GPT-5.4, Gemini 3.1 at 500K-1M that I could verify.

## 4. Negative results: where memory hurts

### Takeaway
Measured harms: irrelevant/similar retrieved experience, stale beliefs, over-trust of stored notes, noisy gains from self-improvement loops, cost without benefit, and metrics that mask broken memory.

### Cited Findings
- AgentCL: memory below memoryless ReAct in naive/held-out coding streams (-0.8 to -5.0 points); topical-similarity-but-incompatible retrieval hurts (Qwen3.5-35B-A3B).
- CL-Bench: stale beliefs and spurious generalizations; ACE costs $62.8/run for 8.6% gain (frontier models).
- SWE-ContextBench: free retrieval of full trajectories raised cost 24-27% with ~+1 point; wrong summaries misleading (Sonnet 4.5; small n).
- **Fragility of Self-Improving Agents** (arXiv 2608.18066, Aug 18 2026, rev Sep 6): re-evaluated two memory-based self-improving methods; "agent evaluation is inherently noisy... stacking a self-improving loop on top can further amplify this noise"; improvement "highly dependent on task order" (default orderings "impose an implicit curriculum"); underspecified tasks contribute; added rubrics/feedback only "partially closes" the gap — [arXiv 2608.18066](https://arxiv.org/abs/2608.18066)
- **Memory Trust Gap** (arXiv 2609.01852, Sep 1 2026; Qwen3 0.6-8B and Llama series only): models answer with the stale stored value 0.92-1.00 of the time in the Benefit suite; larger models collapse most when a stale note looks current; recency cues "fool the larger models harder"; metadata exposure helps capable models only. Small open-weight models; workshop submission — [arXiv 2609.01852](https://arxiv.org/abs/2609.01852)
- **Beyond Downstream QA / FEB-30** (arXiv 2610.22209, Oct 15 2026): intrinsic vs extrinsic evaluation diverge by 16 pp on average, 44% of trajectories exceed threshold; the tested memory system classified create/update/reinforce/supersede correctly only 20% of the time; one system tested — [arXiv 2610.22209](https://arxiv.org/abs/2610.22209)
- MemDelta: write-path cost 50x for equal accuracy; "1,000+ LLM calls" to build memory in its Figure 1 example.
- Complexity Trap: summarization trajectory elongation and ~7% summary-call overhead.
- Reproducibility: MemDelta's embedder flip (+11pp to -1.2pp), Zep/Mem0 dispute, Mem0's own two different scores (per Mem0 page); Ground Truth First notes "label-error and contamination" problems in generate-then-extract benchmarks.
- Position paper "We Should Evaluate Agentic Memory as Inference, not as a Tape Recorder" (NeurIPS position; title only seen in a search listing, not read) — unverified.

### Gaps
- Evidence of memory harming frontier coding agents specifically on SWE-bench-type tasks is thin (CL-Bench codebase task showed no gain, not harm).
- Compression-induced hallucination: no quantified source read.

## 5. Repeated compaction and mitigations

### Takeaway
There is essentially no published measurement I could verify of fact retention or task success over the 2nd..Nth compaction in one session; the mitigation evidence is Factory's single-compaction vendor result and design argument.

### Cited Findings
- Factory (vendor) argues anchored iterative summarization (summarize only the newly truncated span and merge into a persistent summary) with fixed sections "prevents the gradual information loss that occurs with freeform summarization," and that Anthropic's approach regenerates the full summary each time. But the evaluation scores one compression point per prefix, not drift across cycles — [Factory](https://factory.ai/news/evaluating-compression)
- Factory's artifact-trail dimension is weakest (2.19-2.45/5) for every method, motivating a separate file-state ledger — same source.
- Complexity Trap's hybrid (mask first, summarize late at N=43) reduces summarization frequency — [arXiv 2508.21433v3](https://arxiv.org/html/2508.21433v3)
- SNIPPET-ONLY (unverified): Sourcegraph Amp reportedly dropped compaction for hand-off because repeated compression hurt continuity (reported via search summary of Factory coverage).
- Already-read papers, one-line mentions only: Self-Compacting Language Model Agents (2606.23525), Lost in Compaction (2608.11242), Governance Decay (2606.22528), Beyond Compaction (2606.11213).

### Gaps
- No verified data on keeping recent turns verbatim vs not, or on pinned constraints re-injection, outside the excluded papers.

## 6. Continual-learning framing

### Takeaway
External memory yields modest, task-dependent gains, far below what weight updates promise; success is defined as transfer gain over a stateless baseline, and current systems are unreliable.

### Cited Findings
- CL-Bench defines gain = reward with online experience minus the same system's stateless reward; best 25.4% normalized gain (full-context ICL, Sonnet 4.6); decomposes into stability (retaining across variant switches) and plasticity (adapting within variant); ACE and GPT-5.4 ICL show "virtually no stable learning," and agents are "rigid in early, incorrect beliefs" after concept drift. Parametric methods not evaluated — [arXiv 2606.05661](https://arxiv.org/pdf/2606.05661)
- AgentCL measures "transfer gains" (SG/G vs memoryless ReAct) and shows gains only when reusability is built into the stream — [arXiv 2606.02461](https://arxiv.org/html/2606.02461v2)
- SWE-Bench-CL metrics: forward/backward transfer, forgetting, tool-use efficiency; no results read — [arXiv 2507.00014](https://arxiv.org/html/2507.00014v1)
- Fragility paper: gains depend on task order and run variance; need multiple runs.
- Memory-Centric Continual Learning for AI Agents (arXiv 2610.29357) and LifeMem (2609.12655): SNIPPET-ONLY, not read.

### Inferences
- Repeated-mistake reduction is not a standard measured metric in anything I read; forward transfer vs stateless baseline is.

## 7. Frontier vs small-model provenance

| Result | Models | Transfer risk |
|---|---|---|
| CL-Bench | Opus 4.7, Sonnet 4.6, Gemini 3.1 Pro/3 Flash, GPT-5.4 (2026) | Highest relevance |
| LOCA-bench | Opus 4.5, GPT-5.2, Gemini 3 Flash + open | Late-2025 frontier |
| SWE-ContextBench | Sonnet 4.5, GPT-5.3 Codex, open-weight | Frontier, small n |
| LoopsBench | Opus 4.7 + Claude Code | Frontier |
| Ground Truth First | judge claude-sonnet-5; answerer not captured | Single author |
| MemDelta | GPT-4o-mini headline, Gemini, Sonnet (version not captured) | Mixed, older |
| Complexity Trap | Qwen3-Coder 480B, Qwen3-32B, Gemini 2.5 Flash | Pre-4.x/5.x |
| AgentCL | Qwen3.5-35B-A3B | Small open-weight |
| StateMemBench | DeepSeek-V4-Flash, Qwen-3.5-9B, GPT-5.4-Nano | Small/cheap |
| Memory Trust Gap | Qwen3 0.6-8B, Llama | Small; trend says harm grows with capability |
| MemoryAgentBench | GPT-4o-mini, GPT-4.1-mini, Gemini-2.0-Flash, Claude-3.7 | Outdated |
| Letta LoCoMo | GPT-4o-mini | Outdated |
| Factory | GPT-5.2 judge; compressors are products | Vendor |

### Gaps
- Biggest transfer gap: observation-masking vs summarization and repeated compaction have no frontier-model data.
