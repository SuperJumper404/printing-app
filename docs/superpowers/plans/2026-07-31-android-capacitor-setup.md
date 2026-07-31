# Android Capacitor Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Android-capable app shell to the existing SmartEat Printer Agent project while keeping the current Electron desktop app working.

**Architecture:** Keep the current Electron app at the repository root for now. Add Capacitor so the existing Vue/Vite frontend can be built into an Android project, and add a `packages/shared` area for future reusable ticket-formatting code.

**Tech Stack:** Vue 3, Vite, Electron, Capacitor Android, Node/npm.

## Global Constraints

- Do not expose or intentionally edit private runtime data from `settings.json`.
- Preserve the current Electron launch path.
- Prefer gradual migration over moving many files at once.
- Android cannot run Electron; Android must use Capacitor/native Android APIs instead.

---

### Task 1: Add Capacitor Android Shell

**Files:**
- Modify: `package.json`
- Create: `capacitor.config.json`
- Create: `apps/android/README.md`
- Generated: `android/`

**Interfaces:**
- Consumes: existing Vite build output at `frontend/dist`
- Produces: Android project that can be opened with Android Studio through Capacitor

- [ ] Install Capacitor packages.
- [ ] Add Capacitor config pointing to `frontend/dist`.
- [ ] Add npm scripts for Android sync/open/run.
- [ ] Generate Android platform files.
- [ ] Build Vue frontend and sync Android assets.

### Task 2: Add Shared Package Placeholder

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.js`
- Create: `packages/shared/README.md`

**Interfaces:**
- Produces: `createPrintPayload({ ticketType, dataFormatESCPOS })`

- [ ] Add a tiny shared package.
- [ ] Export a validation helper for print payloads.
- [ ] Keep it dependency-free so desktop and Android can both use it later.

### Task 3: Verify Existing Desktop Build Still Works

**Files:**
- No production edits expected.

**Interfaces:**
- Consumes: root `npm.cmd run build`
- Produces: Electron builder artifact or a clear build error unrelated to Android setup

- [ ] Run the frontend build.
- [ ] Run Android sync.
- [ ] Run the existing Electron build command if practical.

