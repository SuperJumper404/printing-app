# GitHub Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish SmartEat Printer Agent Windows releases on GitHub Releases so `electron-updater` can auto-update installed apps.

**Architecture:** Electron Builder publishes Windows artifacts to GitHub Releases. GitHub Actions runs on semantic version tags and uses `GITHUB_TOKEN` to create/update the release and upload `latest.yml`, installers, portable builds, and blockmaps.

**Tech Stack:** Electron, electron-builder, electron-updater, GitHub Actions, Windows runner, Node.js 22.

## Global Constraints

- Keep `settings.json` out of commits and releases.
- Keep the Windows output directory as `dist6`.
- Use the existing GitHub repository `SuperJumper404/printing-app`.
- Preserve existing NSIS and portable Windows targets.

---

### Task 1: Configure GitHub release publishing

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/release.yml`
- Create: `docs/release.md`

**Interfaces:**
- Consumes: existing Electron Builder config.
- Produces: GitHub Releases provider and tag-based CI release workflow.

- [x] Update `build.publish` from generic hosting to GitHub provider.
- [x] Add `release:win` local script.
- [x] Add GitHub Actions workflow for `v*.*.*` tags.
- [x] Document release procedure.

### Task 2: Verify and publish first release

**Files:**
- Read: `package.json`, `index.js`

**Interfaces:**
- Consumes: configured workflow and current app version.
- Produces: first `v1.0.0` release.

- [x] Run syntax/build checks.
- [ ] Commit release automation without `settings.json`.
- [ ] Push `main`.
- [ ] Tag and push `v1.0.0`.
- [ ] Confirm GitHub Actions/release creation.
