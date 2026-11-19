---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read docs/workflows/local-demo.md, apps/unfold/docs/operations/demo.md, docs/concepts/who-unfold-is-for.md and the Known gaps of docs/how-to/self-host-the-whole-stack.md; checked that https://unfoldhq.dev/demo/ answers 200. The demos were not started for this page."
---

# Evaluate Unfold

To decide whether Unfold fits your team, watch it turn a Work Item into a reviewed change, then read what it does not do yet. Every demo on this path is deterministic: it changes real fixture code and runs real checks, but makes no model calls and spends nothing.

## What you get

* The loop end to end: a Work Item, a [Team](../reference/glossary.md#team) of agents, a change, checks, an independent review and the evidence you judge it by.
* An honest list of what is built, what is proposed and what has only run on one cluster.

## Before you start

* For the hosted replay: a browser. Nothing else.
* For a local demo: a clone of [unfold-hq/unfold](https://github.com/unfold-hq/unfold), [mise](https://mise.jdx.dev/), and `mise run setup` once from the repository root.
* For the demo with both applications: Go 1.26 or later and PostgreSQL 17 or later (`initdb` and `postgres` on `PATH`) as well ([Local shared execution demonstration](../workflows/local-demo.md#start)).

## Steps

1. **Watch the recording.** Open [unfoldhq.dev/demo](https://unfoldhq.dev/demo/). It is a recorded replay of the deterministic demo: nothing runs and nothing is sent anywhere ([The hosted replay](../workflows/local-demo.md#the-hosted-replay)).
2. **Run the Unfold application on your machine.** Run `mise run demo` and open `http://127.0.0.1:4080`. Follow [A ten-minute coworker walkthrough](../../apps/unfold/docs/operations/demo.md#walkthrough).
3. **Run both applications.** Run `mise run demo-unified`: a real Ploeg, a private PostgreSQL and the Unfold workbench on your machine. Start the prepared session, pause and resume it, and open its Ploeg Work Item ([Exercise the shared session](../workflows/local-demo.md#exercise-the-shared-session)).
4. **Understand the parts.** Read [How work flows](../concepts/how-work-flows.md), [Architecture](../concepts/architecture.md) and [How agent code is contained](../concepts/how-agent-code-is-contained.md).
5. **Check the limits.** [Who Unfold is for](../concepts/who-unfold-is-for.md) says what is built and what is direction. The [capability matrix](../reference/capability-matrix.md) says which claim needs which setting. Then read the [known gaps](../how-to/self-host-the-whole-stack.md#known-gaps) of a self-hosted installation.
6. **Try it on real work.** When you are ready to spend money, [run your own installation](self-host.md) and [run a pilot batch](../how-to/run-a-pilot-batch.md) of ten Work Items.

## How you know it works

* The local demo with both applications prints `unified-demo.ready` with a workbench URL. Its session finishes with passing checks and an independent review, and its Ploeg Work Item shows the operator Run that did the work.
* `mise exec -- node apps/unfold/scripts/unified-demo.ts --smoke` runs the same path unattended and prints `unified-demo.smoke-passed`, with zero model calls and zero spend ([Automated smoke check](../workflows/local-demo.md#automated-smoke-check)).

The demo always repairs the same fixture, whatever objective you type. It shows how work is supervised and judged, not how well a model understands your code. Only a pilot on your own repositories shows that.
