---
status: accepted
date: 2026-11-19
decision-makers: Ryan Grippeling
review-by: 2027-05-19
---

# The extension is `unfold-hq.unfold-workbench` on every registry

## Context and Problem Statement

[ADR 0075](0075-the-extension-reaches-the-marketplace-through-trusted-publishing-with-release-candidates-as-pre-releases.md) sends the extension to the Visual Studio Marketplace. Its first publication was refused: `ThatsAThoughOne.unfold` has held the name `unfold` since 2026-03-01, and Marketplace extension names are unique across publishers. Open VSX keeps names unique only within a namespace, so `unfold-hq.unfold` exists there.

The identifier is more than a listing. The extension parses `vscode://unfold-hq.unfold/…` links, asks VS Code for an external URI under it for sign-in, and the workbench writes those links and the `vscode:extension/…` link. Which name does the extension carry, and does it differ per registry?

## Decision Drivers

* One identifier everywhere: a link the workbench writes works in every editor, whatever registry installed the extension.
* A name free on both registries, close to what the extension is.
* No code that has to know which registry installed it.

## Considered Options

* Rename to `unfold-workbench` on every registry
* A different name on the Marketplace only
* Stay off the Marketplace

## Decision Outcome

Chosen option: "Rename to `unfold-workbench` on every registry", because it keeps one identifier and is the only option that needs no registry-aware code.

1. The manifest `name` is `unfold-workbench`, so the identifier is `unfold-hq.unfold-workbench`. The display name stays "Unfold — Remote Agent Workbench". Commands, settings and views keep their `unfold.` prefix.
2. Every `vscode://` link, the sign-in callback, the `vscode:extension/` link and the Open VSX listing link use the new identifier. There is no transition period: an installation of `unfold-hq.unfold` no longer handles links from an upgraded workbench.
3. `unfold-hq.unfold` gets no new versions. Its owner marks it deprecated on Open VSX with `unfold-hq.unfold-workbench` as its replacement.
4. Trusted Publishing on Open VSX cannot create an extension, so before the first release under the new name the owner publishes `unfold-hq.unfold-workbench` once with a token, at version `0.4.0-rc.0`, a version the release train never cuts. On the Marketplace, `vsce` creates the extension on its first publication.
5. The pause in `scripts/marketplace_version.py` is lifted.

### Consequences

* Good, because the Marketplace accepts the name and both registries carry one identifier.
* Bad, because everyone with `unfold-hq.unfold` installs the new extension by hand and signs in again: VS Code keeps secrets per extension identifier. This is the third identifier, after `webgrip.unfold` and `unfold-hq.unfold`.
* Bad, because Open VSX shows a `0.4.0-rc.0` that exists only to create the listing.

### Confirmation

The extension and workbench tests check the new identifier in every link they build or parse. The first release after the merge must publish `unfold-hq.unfold-workbench` to Open VSX and, as a pre-release, to the Marketplace, and `release-artifacts-unfold.json` must name it in both `extension` and `marketplace`.

## Pros and Cons of the Options

### A different name on the Marketplace only

* Good, because Open VSX users keep their installation.
* Bad, because the extension and the workbench would have to learn which identifier is installed in which editor before a link works.

### Stay off the Marketplace

* Good, because nothing changes for existing users.
* Bad, because plain VS Code, where most people are, keeps sideloading.

## More Information

Free on 2026-11-19: `unfold-workbench` on the Marketplace (extension query) and `unfold-hq/unfold-workbench` on Open VSX (404). Whether the owner can mark an extension deprecated from the Open VSX namespace settings was not checked.

Reconsider when the Marketplace frees the name `unfold`, which is not expected.
