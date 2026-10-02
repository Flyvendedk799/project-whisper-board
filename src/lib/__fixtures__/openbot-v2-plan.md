# Plan: clean work surfaces, live visibility and runtime fixes

| | |
|---|---|
| **Date** | 2026-10-02 |
| **Base** | `master` @ `b7e0d42` (PR #35 deployed on `openbot.mast3kmedia.dk`) |
| **Status** | Investigation complete, **decisions resolved (§11)**, streaming spike done (§7). Nothing in this document is implemented yet except where marked ✅ |
| **Owner** | Tobias (product), Claude Code (implementation) |
| **Scope** | Everything raised after the first real use of issue-driven work: the issue→Ceo→coder flow, how it is displayed, how it streams, and why the coding console looked dead |

This is both the plan and the technical reference. Each finding has: what you saw, what I verified on the live server, the root cause (with file:line), the fix (with design), and how we know it works.

---

## 0. TL;DR

What you reported, and what is actually going on:

| # | You said | Real cause | Fix (section) | Size |
|---|---|---|---|---|
| 1 | Issue assigned to Ceo didn't start, no Start button, heartbeat ignored it | Assignment only set a column; heartbeat prompt had no issue context | ✅ PR #35 (§2) | done |
| 2 | "No response in the chat that started from the issue" | Issue work runs as a *headless conversation* that is listed among your normal chats, with no progress, and the reply lands only at the end | Separate surfaces + run transcript (§3, §4) | M |
| 3 | Needs to be more intuitive, smart, clean. Chat, issue work and coding must not share UI/place | One generic chat component is reused for three different jobs | New information architecture: **Chat / Work / Code** (§4) | L |
| 4 | Is Ceo's response good? | **Mostly good, three real flaws** (scope creep, vague brief to the coder, empty summary) | Prompt + guard rails (§5) | S |
| 5 | Tool-call "Done" bars stack on top of each other | One full-width card per call, no grouping; reloaded history even renders result objects as nameless cards | Single collapsed group (§6) | S |
| 6 | Reply came in one big chunk instead of live-streaming | The Gemini-subscription path calls the non-streaming endpoint. **Spike confirmed the streaming endpoint works with your login** | SSE implementation (§7) | S–M |
| 7 | Coding job "correctly created" but nothing visible; only moved when files/diff appeared. Should feel like Cursor / Claude Code / Codex: **text first, everything else secondary and expandable** | The runner uses `--output-format text` (no output until the end), the diff pane only reads an artifact written at the end, and the file tree can't even list the changed files | Text-first console on `stream-json`, collapsible dock, follow-up box (§8) | L |
| 8 | (found while investigating) | Desk container fails to start (units bug), **cancel doesn't kill the runner**, internal marker file would be committed into your repo | Runtime fixes (§9) | S |

**Recommended order:** Phase 0 (quick, safe fixes) → Phase 1 (live coding visibility) → Phase 2 (Work surface) → Phase 3 (streaming) → Phase 4 (agent quality) → Phase 5 (automation). See §10.

---

## 1. Evidence (live server, read-only)

All of this was read from the production VPS on 2026-10-01 ~23:05–23:10 UTC without modifying anything.

**The agent:** `Ceo` (`fee2e29b-…`, orchestrator, `gemini-cli` / `gemini-3.1-pro`).

**Its conversations** (table `conversations`): the real chats ("hello", "My friend!", "We need to hire a senior coding dev…") are interleaved with system-created ones:

```
channel_id  user_id  title
headless    system   Task: You have been assigned an issue. Resolve     ← issue run (23:05)
headless    system   Task: Org heartbeat for agent fee2e29b-704a-4f      ← heartbeat (22:51)
web         <you>    hello                                              ← a real chat
```

`runHeadlessTask` creates every system run as a normal conversation (`packages/core/src/conversation.ts:592`, `channelId='headless'`, `userId='system'`, title `Task: <first 40 chars of prompt>`), and `listConversations` (`conversation.ts:1172`) returns them all. That is why issue work shows up inside the chat room.

**The issue run** (`conv_750fd38f…`): the prompt was the structured issue brief; the assistant made five tool calls and answered:

> "I have successfully reviewed and handed off the issues you assigned. 1. **Leader Project (Bad UI issue)** … job `4bf7c690…` is currently running … 2. **Gamehub Project (Login issue)** … I proactively assigned this to the coding agent as well (job `146b7328…`) …"

Tool calls recorded: `assign_coding_task` → `update_issue` → `list_my_issues` → `assign_coding_task` (a *different* issue/project) → `update_issue`.

**The coding job `4bf7c690…`** (PrimeTime, coding, project Leader):

| time (UTC) | event |
|---|---|
| 23:05:52 | queued → running |
| 23:05:54 | "coding SoT resolved" (workspace = git worktree of `flyvendedk799/leader`) |
| 23:06:58 | `desk attach failed: (HTTP code 400) bad parameter - Minimum memory limit allowed is 6MB` |
| 23:06:58 | runner started (`bun … cli.tsx --print --output-format text --bare --dangerously-skip-permissions --model gemini-3.1-pro --max-turns 40 <prompt>`) via the Anthropic-compat bridge to `gemini-cli` |
| 23:06:58 → 23:09:48 | **no further job events** (5 events total in 3 minutes) |

Meanwhile on disk (`data/coding-workspaces/4bf7c690…`): `git status` shows **4 modified files** (`board/page.tsx`, `deals/page.tsx`, `(app)/page.tsx`, `layout/nav.ts`), a fresh `node_modules` (npm install) and a `.next` directory (a build). The agent was clearly working. The UI saw none of it:

* `GET /api/jobs/:id/workspace` → 143 entries, **none of the 4 changed files** (they are 3–4 levels deep).
* `GET /api/jobs/:id/costs` → empty. `GET /api/jobs/:id/artifacts` → one `generic_file` ("Branch openbot/job-…").
* No diff artifact (it is only written when the run ends).

**The second coding job `146b7328…`** (for the *Login* issue, started by Ceo on its own) was **cancelled in the UI at 23:08:36 — but its `bun` process was still running at 23:09:48** (elapsed 02:13, same as the active one). Cancel only changes the DB row.

**Streaming:** the Ceo reply arrived as one block. The Gemini-subscription adapter calls `…:generateContent` and yields the whole answer as a single `text` event (`packages/core/src/ai-client.ts:441`, rationale comment at `:390`).

---

## 2. Issue → work flow ✅ (PR #35) and what is left

**Done in #35:** `IssueRunner` turns an assigned issue into a Job tied to the issue; triggers on assign / In-progress / **Start** button / heartbeat; results and failures are posted back as issue comments; agent tools `list_my_issues`, `update_issue`; `assign_coding_task` takes `issueId`. Verified on prod: the issue started by itself, Ceo delegated correctly, PrimeTime's job is running real code on your repo.

**Still open here:**
* No periodic heartbeat — only manual (§11, Phase 5).
* Issue comments exist in the API/agent tools but **are not rendered anywhere in the UI yet** (§4 fixes this).
* The "agent → coder" hand-off is invisible: you see a Ceo job *and* a coding job but nothing connects them as one story (§4 timeline).

---

## 3. Why issue work and chat feel mixed

Three different activities use the same chat component and the same history list:

| Activity | Who talks | Should be |
|---|---|---|
| Regular chat | You ↔ agent, interactive | **Chat** (conversational, streaming, your history) |
| Issue / task work | System → agent, unattended, minutes long | **Work** (a task with status, timeline, result) |
| Coding | Agent ↔ repo, hours of tool calls | **Code** (a workspace: narrative + changes + terminal) |

Concretely today:
* `AgentRoom` (`/agents/:id`) renders `<Chat botId>` and its sidebar lists *every* conversation of the agent, including `Task: …` runs and heartbeats (`conversation.ts:1172`, `routes/conversations.ts:8-12`).
* A system run opened in the chat UI shows a user bubble containing the machine-written brief and then nothing until the end — which reads as "no response".
* Reloaded history renders tool *results* as separate nameless cards: `toolEvents` is a flat list that interleaves call objects and result objects (`conversation.ts:543,548`), and `mapServerMessages` passes it through unchanged (`ui/src/pages/Chat.tsx:44-52`).

---

## 4. Target information architecture

Principle: **one surface per intent; the same data can be linked, never re-skinned as chat.**

```
Sidebar:  Agents · Chat · Work · Code · Projects · Org · Ops      (Jobs page removed — decided §11.4)
```

> **Jobs page (decided):** folded away. *Work* gets a **Runs** tab (agent/heartbeat/routine runs, filterable by agent/issue/state) and *Code* is the list of coding jobs. `/jobs` redirects to `/work?tab=runs`; existing deep links (`/jobs?highlight=`, `/jobs?projectId=`) keep working through the redirect so no stored link breaks.

### 4.1 Chat (conversations only)
* Lists **only** `kind='chat'` conversations. Agent room = that agent's chats + a small **"Working on"** strip (active issues/jobs for this agent, each a link to Work/Code). No `Task:` rows, ever.
* Streaming reply, grouped tool calls (§6), nothing else.

### 4.2 Work (issues → tasks)
Board stays, but a card opens an **Issue panel** (slide-over, URL `/work/issues/:id`):

```
┌ Add dark mode                      [In progress ▾] [Ceo ▾] [high ▾]   ✕ ┐
│ Project: Leader · repo flyvendedk799/leader                              │
│ ───────────────────────────────────────────────────────────────────────  │
│ Description …                                                            │
│ ───────────────────────────────────────────────────────────────────────  │
│ ● Timeline                                          [Run again]          │
│   23:05  ▶ Ceo started working                                           │
│   23:05  ⚙ Ceo → PrimeTime: "Improve the UI … "      [Open in Code ↗]    │
│   23:05  ▸ Ceo's run (5 tool calls, 38s)            ← collapsed transcript│
│   23:09  🟢 PrimeTime: 4 files changed (+17 −7)     [View changes]       │
│   …                                                                      │
│ ┌ Comment ─────────────────────────────────────────────┐ [Send] [Send & run]│
└──────────────────────────────────────────────────────────────────────────┘
```

* Timeline merges: comments (human + agent), job state changes, child coding jobs (with progress/PR), and a **collapsed** "agent run" transcript (messages with grouped tool calls).
* "Send & run" posts a human comment and re-runs the assignee; the brief already includes the last 5 comments (`issue-runner.ts:89`).
* Statuses (decided §11.2): `open → in_progress → in_review → closed`. A coding job that **opens a PR** moves its issue to `in_review` automatically and the PR link is pinned in the timeline; a human closes it after review. A failed/cancelled job leaves the status as is (the chip shows the failure). Board gets a 4th column; `PATCH /issues/:id` and the agent tool `update_issue` accept `in_review`; the Zod enums in `routes/issues.ts` and `db/src/schema/issues.ts` change together (SQLite stores it as text — no table rebuild, the drizzle enum is type-level only).

### 4.3 Code (coding job = a workspace)
Detailed in §8. Primary = the agent's narrative; files/diff/terminal are secondary and collapsible.

### 4.4 Data model changes

| Change | Why |
|---|---|
| `conversations.kind TEXT NOT NULL DEFAULT 'chat'` (`chat`\|`work`\|`system`) + backfill `UPDATE conversations SET kind='work' WHERE channel_id='headless' AND title LIKE 'Task: You have been assigned%'; … 'system' for heartbeat/routine` | Stop mixing; query by intent |
| `jobs.conversation_id TEXT NULL` | Link a job to its transcript (today nothing links them) |
| `job_events.kind` += `agent_text`, `tool_call`, `tool_result`, `plan` | Live narrative for coding/work jobs (§8) |
| `issues.status` += `in_review` | Issue lifecycle that matches PR flow |

Migrations go in `packages/db/drizzle/` (next number after `0019`); keep everything nullable/defaulted so rollback is safe.

### 4.5 API additions

```
GET  /api/conversations?kind=chat|work|all        default chat; items include `kind`
GET  /api/jobs/:id/transcript                      → { conversationId, messages:[{role,content,toolCalls[],createdAt}] }
GET  /api/issues/:id/activity                      → { issue, comments[], jobs[], children[] }   (timeline source)
POST /api/issues/:id/comments {content, run?:bool} → human comment, optional re-run
GET  /api/jobs/:id/changes                         → { files:[{path,status,additions,deletions}], summary }   (live, §8)
GET  /api/jobs/:id/diff?path=                      → unified diff for one file (live)
GET  /api/jobs/:id/tree?path=                      → one directory level, with `changed` flags (lazy tree)
POST /api/jobs/:id/followup {message}              → running: stdin to the live agent · finished: resume run (returns the new/same job)
```

---

## 5. Was Ceo's response good? (review)

**Verdict: good plumbing, mediocre judgement.**

✅ Correct project and repo resolved from the issue (`Leader` → `flyvendedk799/leader`).
✅ Delegated to the coder with `projectId` + `issueId`, updated the issue, reported the job id.
✅ Honest status ("job is currently running").

❌ **Scope creep.** The run was for *one* issue. It called `list_my_issues`, saw the *Login* issue (another project, `gamehub`) and **started a second coding job unprompted**. That spends tokens/CPU on something you didn't ask for, and its outcome is posted under the wrong run.
❌ **Vague hand-off.** The brief sent to the coder was: *"Improve the UI to make it more optimal and intuitive, addressing the feedback… Review the current UI implementation and refactor."* The issue itself is vague ("Bad ui and non not optimal/intuitive work tool") and Ceo did **not** use `ask_human`. A coding agent given a vague brief will make arbitrary changes (it did edit 4 unrelated-looking pages).
❌ **Empty final message.** "I have successfully reviewed and handed off…" is posted as the issue comment. It doesn't say *what* was delegated, to whom, what to expect, or what happens next.

### Fixes (all small)
1. **Scope guard** (code, not prompt): the run knows its `issueId`; reject `assign_coding_task`/`update_issue` for any other issue id (`conversation.ts` tool handlers, pass `runIssueId` through `sendMessage` opts). `list_my_issues` stays read-only context.
2. **Clarify-before-delegate**: in `IssueRunner.buildBrief` (`issue-runner.ts:89`) add: *"If the description is under ~20 words, ambiguous, or the repo/project may be wrong, call `ask_human` instead of delegating."* and a hard server rule: a coding hand-off whose brief is < N chars and shares >80% of its words with the issue title is rejected with "be specific".
3. **Auto-attach the issue text**: in `toolAssignCodingTask` (`conversation.ts:906`) when `issueId` is set, append the issue title + full description + acceptance notes to the brief so the coder always sees the original ask, not Ceo's paraphrase.
4. **Structured final summary** (template in the brief): `Delegated: <what> → <agent> (job <id>). Next: <PR expected / needs your input>.` and post that to the issue instead of free text.

**Acceptance:** an issue run never touches another issue; a vague issue produces an `ask_human` Needs-you item, not a coding job; the issue comment names agent + job + next step.

---

## 6. Tool-call bars: one collapsed group

**Today:** `Chat.tsx:1188` maps every tool call to a full-width `ToolCallCard` (`components/ToolCallCard.tsx`); five calls = five stacked cards. Reloaded history is worse (see §3).

**Target:** per assistant turn, consecutive calls collapse into **one small line**:

```
 ⚙  Used 5 tools · Assign Coding Task, Update Issue, List My Issues, +2  ▸          (collapsed, ~28px)

 ⚙  Used 5 tools  ▾                                                                  (expanded)
     ✓ Assign Coding Task   "Improve the UI to make it…"                       ▸
     ✓ Update Issue        in_progress                                         ▸
     ✓ List My Issues                                                           ▸
     ✓ Assign Coding Task   "Fix the login button…"                             ▸     (click a row → params/result)
     ✕ Update Issue        failed: Issue not found                              ▾ auto-open
```

Rules:
* While running: one line "⏳ Using Assign Coding Task…" with the spinner; summary updates as calls finish.
* A group ends at the next text segment (calls before and after a paragraph form two groups).
* Failed calls turn the dot red and the failed row auto-expands; the collapsed summary shows "1 failed".
* Row subtitle = the most informative argument (`query`, `command`, `brief`, `path`, …) — reuse the existing summary logic in `ToolCallCard`.

**Implementation**
* New `ToolCallGroup` in `ui/src/components/ToolCallCard.tsx` (keep `ToolCallRow` = existing details body).
* `normalizeToolCalls(list)`: accepts both the live shape (`{id,name,input,status,output}`) and the stored flat shape (`[{type:'tool_use',…},{success,output}…]`) and returns paired calls. Use it in `mapServerMessages` (`Chat.tsx:44`) and the live reducer.
* Stop persisting the flat shape: store paired calls in `messages.tool_calls` (`conversation.ts:543-569`); normalizer keeps old rows readable.
* Reuse `ToolCallGroup` in the issue timeline transcript and in the Code narrative (§8) so tool bars look identical everywhere.

**Acceptance:** 5 sequential calls render as one ≤32px line; expanding shows 5 compact rows; reloading a conversation shows the same grouping (no nameless cards); unit test for `normalizeToolCalls` with both shapes.

---

## 7. Streaming: why Ceo's reply arrived in one chunk

**Cause.** The Gemini *subscription* path (provider `gemini-cli`, i.e. your Antigravity login) is hard-wired to the non-streaming endpoint: `ai-client.ts:441` `fetch(\`${cli.baseURL}:generateContent\`)` and then yields one `text` event (`:394-480`). The comment at `:390` says the streaming variant was not what was verified. Everything downstream (agentic loop `sandbox/src/query-loop.ts`, SSE route, UI `streamChat`) already streams — the Anthropic, OpenAI and Gemini-key paths do. So the fix is local to one method.

**Plan**
1. ✅ **Spike done (2026-10-02, with your approval, one call, on the VPS using the app's own modules; token never printed, script deleted afterwards).**
   * `POST ${baseURL}:streamGenerateContent?alt=sse` (base `daily-cloudcode-pa.googleapis.com/v1internal`) with the **same body** as today → **HTTP 200, `text/event-stream`**. The subscription token is accepted. (The comment at `ai-client.ts:390` was a verification note, not a limitation.)
   * Frame shape: each `data:` line is `{"response":{"candidates":[{"content":{"parts":[…]}}],"usageMetadata":…,"modelVersion":…,"responseId":…},"traceId":…,"metadata":…}` — i.e. exactly today's non-stream payload wrapped per frame, so the existing parsing (`parsed.response?.candidates ?? parsed.candidates`) is reusable.
   * Measured on a tiny prompt ("count 1 to 12"): first frame at **2.85 s**, 3 frames (two with text, one final with usage) arriving within ~6 ms of each other; the non-stream call took **3.87 s**. A short answer is flushed almost at once by the server, so this test proves *the endpoint works and is faster to first byte*, **not** the chunk granularity of a long answer. First task of Phase 3 is to confirm progressive chunking on a long prompt (one more call, same method, **after asking you**) before building UI around it.
2. **Implement** `chatGeminiSubscription` as an SSE reader mirroring `chatGemini` (`ai-client.ts:313-360`): yield `text` deltas per frame; `functionCall` parts arrive whole → yield `tool_use`; capture `usageMetadata` for the usage event; keep the existing `toGeminiTools` sanitising.
3. **Fallback (now only needed if long answers turn out to arrive as one frame):** keep the SSE call but surface honest progress instead of a frozen UI: emit a `status` event ("thinking…"), render tool calls live (they already stream), and reveal the final text with a client-side typewriter capped at ~1.5 s. Do **not** fake token-by-token streaming.
4. **Work/coding runs stream too** — via job events over the existing WS rooms (`job:<id>`), see §8; the issue timeline shows them live.

**Acceptance:** first token visible < 2s after send for a long answer; tool calls and text interleave live; cancel (stop button) aborts the upstream request.

---

## 8. Coding console: text first, everything else secondary

### 8.1 Why it looked dead — five independent causes

| # | Cause | Evidence / location |
|---|---|---|
| a | **No output until the end.** Runner uses `--output-format text` | `CodingAgentService.ts:883` — the CLI prints the final answer only when finished |
| b | **Diff pane reads an artifact written at the end** | `LiveCodeConsole.tsx:206-208` takes the latest `diff_bundle` artifact; `collectGitMeta` runs after the run (`CodingAgentService.ts:419/534`) |
| c | **File tree can't show changed files** | `listWorkspaceFiles` stops at depth 2 and 200 entries (`CodingAgentService.ts:585-616`); the 4 edited files live at `src/app/(app)/…` (depth 3–4) |
| d | **Cost/turns invisible** | costs only written from `log` payloads that never arrive in text mode (`/costs` → empty) |
| e | **No terminal** | desk container failed to create (§9a) so there is nothing to attach to |

The UI polls every 2.5 s (`LiveCodeConsole.tsx:177-183`), so it *did* refresh — there was simply nothing new to show until files were big enough to list.

### 8.2 What good looks like (Cursor / Claude Code / Codex pattern)

```
┌ Leader · Improve the UI…            ● Working · 2m 41s · turn 7/40 · $0.12     [Stop] ┐
│                                                                                       │
│  PLAN  ☑ Audit nav & dashboard   ◐ Refactor board page   ☐ Fix deals table  ☐ Test    │  ← pinned, from TodoWrite
│  ─────────────────────────────────────────────────────────────────────────────────── │
│  I'll start by looking at how the dashboard and board pages are structured…           │  ← agent narrative (markdown),
│                                                                                       │    streaming
│  ⚙ Used 4 tools · Read board/page.tsx, Read nav.ts, +2  ▸                              │  ← §6 group
│                                                                                       │
│  The board uses nested cards with no empty state. I'll restructure it into…           │
│  ⚙ Used 3 tools · Edit board/page.tsx, Edit nav.ts, Bash npm run build  ▸             │
│                                                                                       │
│  ▮ (streaming…)                                                                       │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Changes (4) ▸     Files ▸     Terminal ▸     Preview ▸                    [Open PR]   │  ← collapsed dock; badge live
└───────────────────────────────────────────────────────────────────────────────────────┘
```

* **Primary column = narrative.** Agent text (streamed), the plan checklist, grouped tool calls, then a **final summary card** (what changed, files, tests, PR button).
* **Secondary dock** (collapsed by default, remembers state): **Changes** (live changed-file list → click for diff), **Files** (lazy tree with changed markers), **Terminal**, **Preview**. A badge on "Changes (n)" is how you notice activity without opening it.
* Header always shows: state, elapsed, turn n/max, running cost, **Stop**.
* **Follow-up box — included in this round (decided §11.5).** A composer pinned under the narrative: "Tell it something…".
  * *While the job is running* → the message is delivered to the live agent. The vendored runner supports `--input-format stream-json` (user messages as JSONL on stdin; `--replay-user-messages` echoes them back for acknowledgement — `vendor/claude-code/src/main.tsx:988`). So `runSotPrint` keeps **stdin open**, and `POST /api/jobs/:id/followup` writes `{"type":"user","message":{"role":"user","content":"<text>"}}\n`. The message appears in the narrative as a "You" bubble when echoed.
  * *After the job finished/failed/was stopped* → start a **continuation run in the same workspace and branch** with `--resume <session_id>` (the id is emitted on the `system/init` and `result` lines — `print.ts:640-668`) and the new message as the prompt; it is a new Job row with `parentJobId` = the original, shown as the next segment of the same narrative. If `--resume` can't find the session (different host/restart), fall back to a fresh run whose brief contains the last transcript summary + the new message.
  * Guard rails: disabled while `needs_approval`; one queued message at a time while the agent is mid-tool; rate-limited; every follow-up is an audited event (`job_events.kind='followup'`). A message sent to an issue-linked job is also appended to the issue timeline.
  * **Spike before building (1 h):** confirm the vendored CLI actually consumes mid-run stdin messages in `--print` + stream-json mode and echoes them; if not, mid-run messages degrade to "queued — delivered when the current turn ends" implemented as stop-and-resume.

### 8.3 Runner: stream structured events

The vendored SoT already supports it: `--output-format stream-json` **requires `--verbose`** and `--include-partial-messages` adds token deltas (`vendor/claude-code/src/cli/print.ts:594, 628, 787-790`; flags declared in `main.tsx`).

Change `runSotPrint` (`CodingAgentService.ts:845-886`):

```ts
args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages');
// spawn with a line callback instead of buffering stdout
const proc = await runProcess(bunCmd, args, { cwd, env, timeoutMs, onStdoutLine: (l) => this.handleSotLine(l) });
```

`handleSotLine` parses JSONL and emits `CodingEvent`s:

| SoT line | → event | Notes |
|---|---|---|
| `{"type":"assistant","message":{"content":[{"type":"text"}]}}` / `stream_event` text deltas | `agent_text` | coalesce deltas ≥ 400 ms or ≥ 200 chars before persisting; broadcast every delta over WS |
| `…content:[{"type":"tool_use",name,input}]` | `tool_call` | include a one-line `summary` |
| `{"type":"user","message":{"content":[{"type":"tool_result"}]}}` | `tool_result` | truncate output to 4 KB in the event; full text stays in the transcript store |
| `tool_use` named `TodoWrite` | `plan` | `{items:[{content,status}]}` → pinned checklist |
| `{"type":"result","subtype":"success",total_cost_usd,num_turns,duration_ms,usage}` | `result` | writes `cost_ledger`, final `output`, turn count |

* Persist as `job_events` (new kinds, §4.4) and broadcast on rooms `job:<id>` / `code:<id>` (hub exists: `server/src/ws-hub.ts`, `JobManager.setProgressBroadcaster`).
* **Fallback:** if the first stdout line isn't valid JSON within 10 s, log a warning event and continue in text mode (current behavior) — never fail a job because of the format.
* Keep the existing compat bridge/proxy untouched.

### 8.4 Live "Changes" without waiting for the end

* `GET /api/jobs/:id/changes` → run `git status --porcelain=v1 -z` + `git diff --numstat` (and `--no-index` numstat for untracked) in the job workspace; cache 1 s. Shape: `{files:[{path,status:'M'|'A'|'D'|'?',additions,deletions}], additions, deletions}`.
* `GET /api/jobs/:id/diff?path=…` → `git diff -- <path>` (untracked: `git diff --no-index /dev/null <path>`), size-capped, path-validated with the same separator-safe check used in `writeWorkspaceFile` (`CodingAgentService.ts:~573`).
* Refresh triggers: every `tool_result` for Edit/Write/Bash events (instant), plus the existing 2.5 s poll as a fallback. This replaces the artifact-only diff pane.
* **Tree:** `GET /api/jobs/:id/tree?path=` lists one directory (`git ls-files -co --exclude-standard` grouped by dir) with `changed` flags; hide `node_modules`, `.next`, `dist`, `.turbo`, `coverage`. Lazy-load on expand — removes the depth/200-entry cap.

### 8.5 Component plan (ui)

```
pages/LiveCodeConsole.tsx            → thin shell: header + <Narrative/> + <Dock/>
components/code/Narrative.tsx        → merges agent_text + tool_call groups + plan + final summary
components/code/PlanChecklist.tsx
components/code/Dock.tsx             → tabs: Changes | Files | Terminal | Preview (collapsible, persisted in localStorage)
components/code/ChangesPanel.tsx     → file list + inline diff (reuse existing diff renderer)
components/ToolCallGroup (§6)
components/code/Composer.tsx         → follow-up box (running: stdin message · finished: resume run)
hooks/useJobStream.ts                → subscribes to WS rooms, folds events into narrative state, falls back to polling /events?afterSeq=
```

`GET /api/jobs/:id/events?afterSeq=` (new, tiny) makes reconnect/resume cheap and fixes the "no seq-resume" gap noted in `DELIVERY_STATUS.md`.

**Acceptance:** within 3 s of starting a job, the console shows the agent's first sentence; every tool call appears live as a grouped line; "Changes" badge increments as files change; Stop terminates the process (§9b); after completion the narrative remains readable (it is the transcript).

---

## 9. Runtime bugs found while investigating

### 9a. Desk container never starts — units bug
`DeskManager.parseMemory` (`packages/sandbox/src/deskManager.ts:797-804`) understands `g`, `kb`, `mb` but **not** a bare `m`/`k`. The default `'512m'` falls through to `parseInt('512m')` = **512 bytes**, and Docker answers `400 … Minimum memory limit allowed is 6MB`. Result on prod: every desk is "volume-only", so no terminal/preview, and `desk attach failed` is logged on every job. (`sandbox/src/engine.ts:32-37` has a second, simpler parser that assumes megabytes for anything but `g` — which happens to work for `512m`. Two parsers with different rules is the real smell: unify them.)

**Fix:** one shared `parseMemory` accepting `b|k|kb|m|mb|g|gb` (case-insensitive); a bare number means **megabytes** (matching the engine's behavior and the `SANDBOX_MAX_MEMORY` docs); reject/clamp anything that resolves below 6 MB with a clear log line instead of letting Docker fail. Unit tests: `512m → 536870912`, `1g → 1073741824`, `256mb → 268435456`, `512 → 536870912`, `1kb` → rejected (< 6 MB). Add a startup self-check that creates and removes a throwaway container and reports in **System check**.
*Also measure:* there is a 64 s gap between "SoT resolved" (23:05:54) and the desk failure (23:06:58). Add timing logs around `createDesk` / `ensureImageExists` / `createContainer` to find it.

### 9b. Cancel does not stop the runner
`JobManager.cancelJob` (`core/src/jobs.ts:881-890`) only sets state `cancelled`. The `bun` child keeps running, keeps spending tokens, keeps editing files — observed live (cancelled 23:08:36, still running at 23:09:48).

**Fix:**
* `CodingAgentService` keeps a static registry `jobId → {child, pgid}`; spawn with `detached: true` and kill the **process group** (`process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 5 s) — the runner is `sh → bun → …` (we saw both `/bin/sh bun` and `bun.exe` processes).
* `cancelJob` calls `CodingAgentService.cancel(jobId)`; the timeout path (`:963`) and `recoverInterruptedJobs` use the same call.
* Write a pidfile at `data/coding-workspaces/<jobId>.pid` (outside the repo) and sweep orphans at boot.
**Acceptance:** cancel → process gone within 5 s, state `cancelled`, no further file changes; test with a stub child.

### 9c. Internal marker file gets committed into your repo
The workspace contains an untracked `.openbot-coding-job.json` (`CodingAgentService.ts:332`). The PR step does `git add -A` (`tryCreatePrDetailed`), so it ends up in the pull request.
**Fix:** write it to the git exclude file (`git rev-parse --git-path info/exclude`, works for worktrees) or store it outside the workspace. Test: after a dry-run job, `git status --porcelain` has no `.openbot-*`.

---

## 10. Phased plan

Estimates are focused engineering time, including tests; each phase ships as its own PR.

### Phase 0 — quick, safe fixes (≈ ½ day)
| Task | Files | Test |
|---|---|---|
| Memory-unit parser (§9a) + desk self-check in System check | `sandbox/src/deskManager.ts`, `engine.ts`, `server/src/routes/system.ts` | unit |
| Kill runner on cancel/timeout, process-group, pidfile sweep (§9b) | `coding-agent/src/CodingAgentService.ts`, `core/src/jobs.ts` | stub-child test |
| Exclude marker file (§9c) | `CodingAgentService.ts` | dry-run job test |
| `ToolCallGroup` + `normalizeToolCalls` (§6) | `ui/src/components/ToolCallCard.tsx`, `pages/Chat.tsx`, `conversation.ts` (paired storage) | vitest for normalizer + smoke |
| Conversation `kind` + default `chat` filter (§4.4) | `db` migration, `conversation.ts`, `routes/conversations.ts` | route test, smoke |

### Phase 1 — live coding visibility + follow-up box (≈ 3–4 days)
Runner `stream-json` + event mapping (§8.3), `changes`/`diff`/`tree` endpoints (§8.4), `useJobStream`, text-first console (§8.5), cost ledger from `result`, **follow-up composer** (§8.2: stdin while running, `--resume` after).
*Spikes first (≈ 2 h):* (1) run the vendored CLI with `--output-format stream-json --verbose --include-partial-messages` against the bridge locally and save a real transcript as a test fixture; (2) prove mid-run stdin delivery with `--input-format stream-json`. Both fixtures become CI tests.

### Phase 2 — Work surface (≈ 2 days)
`jobs.conversation_id`, `/jobs/:id/transcript`, `/issues/:id/activity`, `POST /issues/:id/comments`, Issue panel with timeline, `in_review` status + automatic move on PR (board 4th column, `update_issue` tool, enums), "Working on" strip in agent rooms, **Jobs page folded into Work → Runs and Code** with the `/jobs` redirect (§4.1).

### Phase 3 — streaming (≈ 1 day after the spike)
Confirm chunk granularity on a long prompt (one more call — **needs your OK first**), then `chatGeminiSubscription` SSE (§7); live narrative for work runs over WS.

### Phase 4 — agent quality (≈ ½–1 day)
Scope guard, clarify-before-delegate, auto-attach issue text, structured summary (§5). Add an eval-style test: given a vague issue + a second open issue, assert `ask_human` is called and no second job is created.

### Phase 5 — automation & hygiene (≈ 1 day)
* Opt-in periodic heartbeat per agent (`OPENBOT_HEARTBEAT_MINUTES`, off by default; cost-aware; picks up *open* assigned issues only).
* Ops hygiene on the VPS (table below).

#### Ops hygiene items (VPS)
| Item | Observed | Fix |
|---|---|---|
| API runs with `NODE_ENV=development` | `OpenBot-Web` is a Vite process, which sets `NODE_ENV`; the wrapper does `process.env.NODE_ENV \|\| 'production'` (`embed-openbot.mjs`) | pass `NODE_ENV: 'production'` explicitly to the child |
| `OPENBOT_SECRET` not set | secret comes from `data/openbot.secret` | set it in the ServerHoster service env to the same value (don't change the value or stored keys become unreadable) |
| Untracked `bots/ceo`, `bots/github-operator`, `bots/pr-reviewer` in the checkout | written by the old disk-export (removed in #32); they'd seed *new tenants* | delete the three directories on the VPS |
| Dirty tracked files (`.survhub-vite.config.mjs`, `tsconfig.tsbuildinfo`) | generated on the box | untrack `tsbuildinfo` (it is build output); keep config generated |

---

## 11. Decisions (resolved 2026-10-02)

| # | Question | Decision | Effect on the plan |
|---|---|---|---|
| 1 | Keep auto-start on assignment? | **Yes, keep on** | Already shipped (#35). `OPENBOT_ISSUE_AUTOSTART=0` remains the opt-out. The scope guard and clarify-first rules (§5) make it safe to leave on. |
| 2 | Add an `in_review` status? | **Yes** | `open → in_progress → in_review → closed`; auto-move when a PR is opened (§4.2, Phase 2). |
| 3 | One streaming test call with your Antigravity login? | **Yes — done** | Result in §7: endpoint works with subscription tokens. You approved **one** call and it is used. Confirming long-answer chunking needs a second call, which I will **ask you about first**. |
| 4 | What happens to the Jobs page? | **Fold into Work and Code** | §4.1: *Work → Runs* tab + *Code* list; `/jobs` redirects. |
| 5 | Follow-up box in the coding console this round? | **Include now** | §8.2 / §8.5 / Phase 1 grows by ≈ 1 day; stdin-while-running + resume-after. |

---

## 12. Test & verification plan

* **Unit/integration (CI):** `parseMemory`, `normalizeToolCalls`, stream-json line mapper (fixture from the Phase-1 spike), kill-process-group, marker-exclude, conversation `kind` filtering/backfill, issue scope guard, `changes`/`diff` path validation.
* **Smoke (`scripts/ui-smoke.mjs`):** extend with a seeded issue + fake streaming job to assert: no `Task:` rows in Chat history; Issue panel renders timeline; Code console shows narrative before any file changes; tool group collapsed by default.
* **Follow-up box:** integration test with a stub runner that echoes stdin; E2E: send a message mid-run → "You" bubble appears and the next agent text references it; after completion → continuation job with `parentJobId`, same branch.
* **Live checks after deploy (reproduce my evidence):**
  ```bash
  # headless conversations must no longer appear in chat history
  curl -s -b cookie /api/conversations?botId=<ceo> | jq '[.items[]|select(.title|startswith("Task:"))]|length'   # expect 0
  # live changes while a job runs
  curl -s -b cookie /api/jobs/<id>/changes | jq '.files|length'                                              # >0 within seconds of the first edit
  # cancel really stops it
  curl -s -b cookie -X POST /api/jobs/<id>/cancel; sleep 6; ps aux | grep <id>                               # no bun process
  ```
* **Rollback:** migrations are additive/nullable; `stream-json` falls back to text mode; UI groups/dock are presentational.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| `stream-json` schema in the vendored SoT differs from upstream Claude Code | Phase-1 spike records a real fixture; mapper ignores unknown line types; text-mode fallback |
| Event volume (token deltas) floods the DB/WS | coalesce before persisting; WS gets deltas, DB gets chunks; cap events/job; truncate tool results |
| Killing a process group on Windows dev boxes | Windows path: `taskkill /T /F /PID`; covered by platform switch + test |
| Gemini streaming endpoint rejects subscription tokens | explicit fallback in §7 (no fake streaming) |
| Scope guard blocks legitimate multi-issue runs | only for issue-started runs; heartbeat/chat runs keep full freedom |
| Migration backfill mislabels a real chat as `work` | backfill only on `channel_id='headless' AND user_id='system'` |
| Mid-run stdin messages not honored in `--print` mode | Phase-1 spike; degrade to "queued until current turn ends" via stop-and-`--resume` |
| `/jobs` redirect breaks old bookmarks/deep links | redirect preserves query (`highlight`, `projectId`); smoke test covers it |

---

## Appendix A — file index

| Concern | Files |
|---|---|
| Conversations / headless runs | `packages/core/src/conversation.ts` (`runHeadlessTask:588`, `listConversations:1172`, tool storage `:543-569`), `packages/server/src/routes/conversations.ts` |
| Issue runs | `packages/core/src/issue-runner.ts`, `packages/server/src/routes/issues.ts`, `packages/core/src/event-bus.ts` (`processOrgHeartbeat`) |
| Tool-call UI | `packages/ui/src/components/ToolCallCard.tsx`, `packages/ui/src/pages/Chat.tsx` (`:44`, `:1188`) |
| Gemini subscription adapter | `packages/core/src/ai-client.ts` (`chatGeminiSubscription:394`, endpoint `:441`) |
| Coding runner | `packages/coding-agent/src/CodingAgentService.ts` (`runSotPrint:845`, marker `:332`, tree `:585`, PR `tryCreatePrDetailed`) |
| Job lifecycle | `packages/core/src/jobs.ts` (`cancelJob:881`, `recoverInterruptedJobs`) |
| Live Code UI | `packages/ui/src/pages/LiveCodeConsole.tsx` (polling `:177`, diff `:206`), `packages/server/src/routes/jobs.ts` (`/workspace:245`) |
| Desks | `packages/sandbox/src/deskManager.ts` (`parseMemory:797`, create `:114`), `packages/sandbox/src/docker.ts` |
| Vendored runner flags | `vendor/claude-code/src/cli/print.ts:594,628,787`, `vendor/claude-code/src/main.tsx` |

## Appendix B — what is already fixed (for context)

PR #32 usable-end-to-end baseline · #33 embedded API auto-restart · #34 provider/model mismatch · #35 issues → jobs. The `Ceo` agent, the Antigravity connection and the real coding pipeline (SoT through the Anthropic-compat bridge on `gemini-cli`) are confirmed working on prod; this plan is about *seeing and steering* that work, and making it feel like a product.
