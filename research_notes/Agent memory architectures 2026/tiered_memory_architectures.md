# Tiered / multi-layer memory architectures for LLM agents (as of Nov 2026)

Already-read papers, one-line mention only: Self-Compacting Language Model Agents (2606.23525), Lost in Compaction (2608.11242), Governance Decay (2606.22528), Beyond Compaction (2606.11213).
Method note: sources below were opened and read (HTML/abstract) unless marked UNVERIFIED. Vendor/author claims are labelled [VENDOR] or [AUTHORS]; independent is [INDEP]. Items before 2025 are background.

## 1. MemGPT / Letta: tiers, self-editing blocks, sleep-time compute, move to filesystems

### Takeaway
MemGPT (2023, background) is the canonical main-context/external-context design, and your short-term layer (summary + pinned constraints) is close to its "working context + recursive summary". Letta's own later trajectory is toward plain files (Aug 2025 benchmark post, Feb 2026 "context repositories"), which is close to your long-term-docs-by-pointer layer. Sleep-time evidence is real but narrow (math tasks, predictable queries).

### Cited Findings
- MemGPT (Oct 2023, background): main context = system instructions (read-only) + "working context" (fixed-size read/write text, writable only via function calls: key facts, preferences) + FIFO queue of messages, whose first slot holds "a recursive summary of messages that have been evicted". External context = recall storage (full message DB) and archival storage (arbitrary text, vector search via pgvector). — [MemGPT](https://arxiv.org/html/2310.08560)
- MemGPT eviction/promotion mechanics: at a "warning token count" (e.g. 70% of window) a "memory pressure" system message lets the LLM save important items to working context/archival; at the "flush token count" (100%) the queue manager evicts e.g. 50% of the window, regenerates the recursive summary from old summary + evicted messages; evicted messages remain in recall storage. The LLM itself decides moves via function calls. — [MemGPT](https://arxiv.org/html/2310.08560)
- Letta describes the same hierarchy as "core memory" (in-context) vs "conversational memory, archival memory, and external files". — [Letta, Aug 2025 [VENDOR]](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- Sleep-time compute paper (Apr 2025) [AUTHORS, Letta+Berkeley]: abstract says it "can reduce the amount of test-time compute needed to achieve the same accuracy by ~5x on Stateful GSM-Symbolic and Stateful AIME", scaling sleep-time compute "increase[s] accuracy by up to 13% on Stateful GSM-Symbolic and 18% on Stateful AIME", amortizing across related queries cuts per-query cost 2.5x. Efficacy "well correlated" with query predictability from the context; for unpredictable queries "it may be preferable to apply standard test-time scaling instead". Also: 5 parallel sleep-time generations generally outperformed 10. A realistic SWE case study exists but I did not read its numbers. — [arXiv 2504.13171](https://arxiv.org/html/2504.13171v1)
- Letta's productization (Letta 0.7.0, Apr 2025) [VENDOR]: two agents; the primary agent has recall/archival search but NOT core-memory edit tools; the sleep-time agent edits the primary's memory blocks asynchronously ("anytime"). Stated rationale: in MemGPT, memory management and conversation are bundled, so the agent "may be slower... and potentially less reliable"; and "memory formation in MemGPT is incremental, so memories may become messy and disorganized over time". Sleep agent can use a stronger model. — [Letta blog](https://www.letta.com/blog/sleep-time-compute). Docs warned sleep-time agents were "experimental and may be unstable" (from search snippet only; docs page itself returned empty: UNVERIFIED).
- No independent replication of sleep-time benefits on coding/long-running agent memory found. The blog's claim that most Letta agents will become sleep-time-enabled is a vendor prediction.
- Aug 2025 [VENDOR]: Letta put LoCoMo history in a file and gave the agent `grep`, `search_files`, `open`, `close`; gpt-4o-mini scored "74.0% on LoCoMo", "significantly above Mem0's reported 68.5% score for their top-performing graph variant". Letta's reasoning: models are post-trained on filesystem/coding tools; "memory is more about how agents manage context than the exact retrieval mechanism"; "current memory benchmarks may not be very meaningful". Caveats stated in the post: agent was only "partially autonomous" via tool rules; Letta disputes how Mem0 ran MemGPT. — [Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- Critics (secondary, search snippets, UNVERIFIED): Mem0 reportedly now claims 92.5 on LoCoMo (April 2026 pipeline rewrite) and Letta did not rerun; LoCoMo allegedly lacks knowledge-update scoring. — [Aktagon summary](https://signals.aktagon.com/articles/2026/02/benchmarking-ai-agent-memory-is-a-filesystem-all-you-need/), [Boschi](https://buttondown.com/nicoloboschi/archive/file-based-agent-memory-great-demo-good-luck-in/) (Boschi likely has a competing product; not opened).
- Context Repositories (Feb 12, 2026) [VENDOR]: memory rebuilt as a git-backed local filesystem for Letta Code. "The filetree structure is always in the system prompt"; each file has frontmatter `description`; a `system/` dir is "always fully loaded", agents move files in/out of it "to control what's pinned to context". Skills: memory *initialization* (parallel subagents in git worktrees), *reflection* (background "sleep-time" process, commits, merges back), *defragmentation* ("memories inevitably become less organized"; subagent splits large files, merges duplicates, restructures to "15-25 focused files"). Enabling `/memfs` "will detach the memory(...) tool" and sync blocks to files. Stated rationale: earlier approaches "limited agents to MemGPT-style memory tools or virtual filesystem operations"; sleep-time learning was single-threaded because no concurrent-write mechanism. — [Letta blog](https://www.letta.com/blog/context-repositories)
- Current docs (MemFS): memory addressed by path; root files loaded into system prompt every turn; directories with own `MEMORY.md` stay out of context, root `MEMORY.md` lists them as signposts; "All Letta agents use MemFS"; no vector index by default ("normal file-search and read tools"); subagents "dreaming" and "memory doctor" use worktrees. — [Letta docs](https://docs.letta.com/concepts/memfs)

### Inferences
- Letta effectively abandoned (as primary mechanism) the MemGPT self-edit `memory()` tool + blocks in favor of files + git, and replaced in-line self-editing with background reflection. This is the closest prior art to the user's design, including pointer-based progressive disclosure and an always-loaded pinned set.
- Letta's own defrag skill is evidence that file-based long-term memory also needs periodic restructuring; "docs on disk" is not maintenance-free.
- The 74% LoCoMo result is a vendor result on a retrieval-QA benchmark with a weak model; it supports "agentic grep over files is a strong baseline", not "filesystem memory is sufficient for coding agents".

### Gaps
- Could not open docs.letta.com sleeptime page (empty), so the "experimental" warning is snippet-only. No Letta post explicitly "abandoning" blocks; the /memfs detach statement is the nearest. Letta Leaderboard numbers not read.

## 2. CoALA taxonomy and mapping

### Takeaway
CoALA: short-term working memory plus three long-term stores (episodic, semantic, procedural). The user's (a) = working; (b) is a hybrid with no CoALA analogue; (c) is semantic/episodic/procedural mixed together. Procedural and episodic memory are the parts the three layers do not distinguish.

### Cited Findings
- CoALA (Sumers et al., 2023, background): working memory "maintains active and readily available information... for the current decision cycle" and is "more general" than the LLM context: "a data structure that persists across LLM calls"; episodic = "experience from earlier decision cycles"; semantic = "knowledge about the world and itself"; procedural = rules/code (productions in Soar; LLM weights and agent code in language agents). Actions split into retrieval (LTM->WM), reasoning (update WM), learning (write LTM). — [CoALA](https://arxiv.org/html/2309.02427)
- CoALA notes learning by "reflecting on episodic memory to generate new semantic inferences (Shinn et al.)" and by "modifying their program code to generate procedural knowledge" (same source).
- 2026 survey frames the same split functionally: factual/experiential/working (Hu et al.) — [Memory in the Age of AI Agents, 2512.13564](https://arxiv.org/abs/2512.13564) (abstract only read).

### Inferences
- Mapping: (a) = CoALA working memory (but CoALA's WM is a structured variable store, not only the window). (b) pinned constraints = procedural/semantic "standing rules" (closest to Letta `system/` files); (b) compaction summary = episodic, compressed. (c) disk docs = semantic + procedural (skills/playbooks) + archived episodic.
- Left out: (1) a verbatim episodic log (raw transcript/recall storage, as in MemGPT recall); with only a lossy summary, episodes are unrecoverable. (2) Explicit procedural memory with its own write path (learned workflows, cf. AWM/ACE). (3) A promotion/consolidation path from (b) to (c).

### Gaps
- No source found that maps a coding-agent compaction summary onto CoALA; the mapping is my inference.

## 3. Memory systems: tiers, write/read, gains, weaknesses

### Takeaway
Most systems are write-time LLM extraction + retrieval store. Reported gains are mostly authors' own on LoCoMo/LongMemEval; independent 2026 evaluations find no system dominates and many underperform simple baselines.

### Cited Findings
- Generative Agents (2023, background): retrieval scores memories by recency (exponential decay), relevance (embedding sim), importance (LLM 1-10); reflections are written back as higher-level memories. — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442); scoring detail from [survey 2603.07670](https://arxiv.org/html/2603.07670).
- Mem0 (Apr 2025) [AUTHORS]: extract/consolidate/retrieve; "26% relative improvements in LLM-as-a-Judge over OpenAI", "91% lower p95 latency", ">90% token cost" saving vs full-context on LoCoMo. — [arXiv 2504.19413](https://arxiv.org/abs/2504.19413). Independent: MemUse (2608.24189) reportedly finds Mem0 below a summary/long-context baseline in natural conversation (search snippet, UNVERIFIED).
- Zep/Graphiti (Jan 2025) [AUTHORS, vendor]: temporal knowledge graph; DMR 94.8% vs MemGPT 93.4%; LongMemEval "up to 18.5%" accuracy gain, 90% latency cut. — [arXiv 2501.13956](https://arxiv.org/abs/2501.13956)
- A-MEM (Feb 2025, v11 Oct 2025) [AUTHORS]: Zettelkasten notes; new memories can "trigger updates to the contextual representations and attributes of existing historical memories" (in-place rewrite of old memory). — [arXiv 2502.12110](https://arxiv.org/abs/2502.12110)
- MemoryOS (May 2025) [AUTHORS]: three tiers short/mid/long-term personal memory; short->mid "dialogue-chain-based FIFO", mid->long "segmented page organization"; +49.11% F1 / +46.18% BLEU-1 on LoCoMo (GPT-4o-mini). — [arXiv 2506.06326](https://arxiv.org/abs/2506.06326)
- MIRIX (Jul 2025) [AUTHORS]: six memory types (Core, Episodic, Semantic, Procedural, Resource, Knowledge Vault) with multi-agent updater; LoCoMo 85.4%; +35% over RAG on ScreenshotVQA. — [arXiv 2507.07957](https://arxiv.org/abs/2507.07957)
- LightMem (Oct 2025, v4 Feb 2026) [AUTHORS]: sensory -> topic-aware short-term -> long-term with "sleep-time update" decoupling consolidation from inference; up to 7.7%/29.3% accuracy gain, up to 38x/20.9x fewer tokens (LongMemEval/LoCoMo). — [arXiv 2510.18866](https://arxiv.org/abs/2510.18866)
- Experience/procedural memories: Dynamic Cheatsheet (Apr 2025) [AUTHORS]: self-curated cheatsheet; Claude 3.5 Sonnet AIME accuracy "more than doubled", GPT-4o Game of 24 10% -> 99%; its updates rewrite the sheet each step (ACE shows this collapses, see section 4). — [arXiv 2504.07952](https://arxiv.org/abs/2504.07952). Agent Workflow Memory (Sep 2024, background): +24.6%/+51.1% relative success on Mind2Web/WebArena. — [arXiv 2409.07429](https://arxiv.org/abs/2409.07429). ReasoningBank (Sep 2025, v2 Mar 2026) [AUTHORS, Google]: distills strategies from self-judged successes AND failures; beats raw-trajectory and success-only memories on web and SWE benchmarks (no numbers read). — [arXiv 2509.25140](https://arxiv.org/abs/2509.25140). Reflexion, ExpeL, HippoRAG: not opened (no claims made).
- MemoryAgentBench [INDEP-ish, Hu/Wang/McAuley; v4 Jun 2026]: four competencies (accurate retrieval, test-time learning, long-range understanding, selective forgetting); "current methods fall short of mastering all four". Survey 2603.07670: "most fail conspicuously on selective forgetting"; "Nobody evaluates forgetting well". — [arXiv 2507.05257](https://arxiv.org/abs/2507.05257), [survey](https://arxiv.org/html/2603.07670)
- MemFail (May 2026, Berkeley) [INDEP]: tested Mem0, A-MEM, SimpleMem, StructMem; "no single system dominates: each architecture exhibits a distinctive failure signature", e.g. graph-based StructMem "excels at causal reasoning but collapses on coexisting-fact retrieval, while Mem0 shows the opposite". Frames failures as summarization, storage, retrieval. Search summary says most failures are in retrieval/summarization not storage (snippet-level, UNVERIFIED). — [arXiv 2605.26667](https://arxiv.org/html/2605.26667)
- Control-plane study (Jun 2026, single author at a memory startup, DeepLethe; treat cautiously): 13 configs on a 385-case forgetting/mutation set; deterministic primitives <=5% on identifier-obfuscation; LLM at write time cannot do intent-aware deletion (0%); a mutation-time LLM hook reaches 78-85% there. — [arXiv 2606.15903](https://arxiv.org/html/2606.15903)
- Also seen only as titles/snippets (UNVERIFIED): AMA-Bench 2602.22769 (long-horizon agentic memory; A-MEM > Mem0 in its table), OP-Bench (memory setups below no-memory baseline, via a Mem0 blog).

### Inferences
- Reported gains are overwhelmingly vendor/author LoCoMo or LongMemEval numbers; LoCoMo scores of 68-92% from different vendors are not comparable (different judges, backbones, prompts).
- Reflection/consolidation designs (A-MEM in-place evolution, DC rewriting) are exactly where drift enters; the append/delta designs (ACE) and tiered promotion with verification are the safer pattern.

### Gaps
- Per-system independent numbers for MemoryOS, MIRIX, LightMem, HippoRAG, ExpeL, Reflexion not found. No notable 2026 *new* tiered system beyond the benchmarks/surveys above verified in this pass.

## 4. Consolidation between tiers; ACE; drift and collapse

### Takeaway
The best-documented failure is rewrite-induced collapse. ACE's evidence (one AppWorld case, plus ablations) supports itemized append/delta updates with deterministic merge over LLM full rewrites.

### Cited Findings
- ACE (Oct 2025, v3 Mar 2026; ICLR 2026) [AUTHORS]: names two failures. "Brevity bias: the tendency of optimization to collapse toward short, generic prompts"; "context collapse: methods that rely on monolithic rewriting by an LLM often degrade into shorter, less informative summaries over time". Case: with Dynamic Cheatsheet on AppWorld, "at step 60 the context contained 18,282 tokens and achieved an accuracy of 66.7, but at the very next step it collapsed to just 122 tokens, with accuracy dropping to 57.1—worse than the baseline accuracy of 63.7 without adaptation." The authors say the issue "is not specific to that method". — [ACE](https://arxiv.org/html/2510.04618v3)
- ACE design: Generator / Reflector / Curator; context as itemized "bullets"; Curator emits compact delta entries "merged deterministically into the existing context by lightweight, non-LLM logic"; "grow-and-refine" de-duplication run "proactively (after each delta) or lazily (only when the context window is exceeded)". Bullets carry bookkeeping on which entries helped or harmed. Reported: avg +10.6% on agent tasks, +8.6% on finance; on AppWorld offline adaptation input/output tokens down 80.8%/83.6% vs GEPA; ablations credit incremental delta update with "a large share of ACE's gains". Robustness check: a weaker or occasionally harmful Reflector degrades results (Tables 16-17, FiNER; e.g. 66.7 (-4.0) for one weaker reflector). — [ACE](https://arxiv.org/html/2510.04618v3)
- Survey 2603.07670 (Mar 2026): "summarization drift. Each compression pass silently discards low-frequency details"; worked example of a day-one rule ("never call the production database directly") vanishing by the third summary pass; "context-resident memory should be supplemented—not replaced, but supplemented—with an external store that preserves raw records at full fidelity". Reflection failure: "self-reinforcing error" (a false belief is never re-tested); mitigation "reflection grounding" = cite concrete episodic evidence. Hierarchical-memory orchestration failures are "silent" (wrong eviction = slightly worse answers, no error); too-aggressive archiving causes "memory blindness". Stale/contradictory records need temporal versioning, source attribution ("user statement >> agent inference"), contradiction flagging, scheduled consolidation sweeps. — [survey 2603.07670](https://arxiv.org/html/2603.07670)
- Same survey proposes (as a suggestion, not tested) "dual-buffer consolidation": new memories sit in a hot buffer on probation, promoted to long-term only after re-verification, dedup, importance scoring. — same source
- Who decides promotion: MemGPT = the LLM itself on memory-pressure warning; Letta sleep-time/reflection = separate background agent; ACE = Reflector+Curator with deterministic merge; MemoryOS = FIFO/heat-based rules; LightMem = offline sleep-time pass. (sources above)

### Inferences
- For the user's design: the pinned-constraints list is the high-importance, low-frequency content that rewrite-based summarization drops; keeping it as an itemized append-only/delta-edited list outside the summary, never regenerated by the summarizer, matches ACE and the survey's example. (Compaction-specific evidence: see the four already-read papers.)
- ACE evidence is on benchmarks with an environment feedback signal (execution results); a coding agent has similar signals (tests), but ACE's own tables show sensitivity to bad reflector output.

### Gaps
- No controlled study found of repeated compaction-summary drift in coding agents beyond the already-read papers. ACE's collapse is one documented trajectory.

## 5. 2026 surveys and open problems

### Cited Findings
- "Memory for Autonomous LLM Agents" (Mar 2026, arXiv 2603.07670): covers 2022-early 2026; open challenges: "continual consolidation, causally grounded retrieval, trustworthy reflection, learned forgetting, and multimodal embodied memory"; also "principled consolidation": systems "oscillate between hoarding... and amnesia"; open questions include how to estimate importance "without future-sight" and "how to guarantee that safety-critical records survive". Also: "Stale or hallucinated recall can be worse than no recall at all." — [link](https://arxiv.org/html/2603.07670)
- "Memory in the Age of AI Agents" (Dec 2025, v2 Jan 2026, 2512.13564): taxonomy Forms (token/parametric/latent) x Functions (factual/experiential/working) x Dynamics (formation/evolution/retrieval). Abstract page only; open-problem list not read. — [link](https://arxiv.org/abs/2512.13564)
- "From Storage to Experience" (Jan 2026, preprints.org): Storage -> Reflection -> Experience stages. Snippet only, UNVERIFIED. — [link](https://www.preprints.org/manuscript/202601.0618/v2)
- Letta frames evaluation problem: quality "depends more on the underlying agentic system's ability to manage context and call tools than on the memory tools themselves" [VENDOR] — [Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory)

### Gaps
- "Continual learning via memory" position papers: none opened in this pass; ACE/ReasoningBank/DC are the experimental representatives (test-time learning without weights).

## 6. Reports of tiered designs abandoned or simplified

### Cited Findings
- Letta moved from MemGPT-style blocks + memory tool to git-backed files and "detach[ed] the memory(...) tool" (Feb 2026, see section 1) [VENDOR]; argued filesystem tools beat specialized memory tools because models are trained on them (Aug 2025) [VENDOR].
- Letta split memory writing out of the conversational agent (sleep-time agents) because bundled tool use was slower and "potentially less reliable" [VENDOR].
- Survey warns that sophisticated hierarchies fail silently and need operation logs few systems keep (survey 2603.07670).
- Independent evidence that complexity does not reliably pay: MemFail (no dominant system); MemUse and OP-Bench snippets (UNVERIFIED) report memory systems at or below simple baselines.

### Inferences
- I found no explicit post-mortem of a *three-tier* design being dropped by a third party. The clearest "simplification" signal is Letta's own, vendor-reported.

### Gaps
- LangGraph/LangMem and LlamaIndex memory docs and engineering blogs were not reached within the tool budget; no claims made about them.
