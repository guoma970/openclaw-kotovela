# Release Candidate Checklist

Scope: public/open-source repository publishing review for Kotovela Hub / openclaw-kotovela.

## Submit candidates

These files look suitable to include after review:

- `README.md`, `CONTRIBUTING.md`, `LICENSE`, `CHANGELOG-OPEN-SOURCE-CONVERGENCE.md`
- `package.json`, `package-lock.json`, TypeScript/Vite/ESLint config files
- `src/**`, `api/**`, `server/**` source files
- `scripts/check-office-api.mjs`
- `scripts/install-office-bridge-runtime-launchd.sh`
- `scripts/rollback-office-bridge-runtime-launchd.sh`
- `scripts/install-office-api-launchd.sh` (compatibility wrapper)
- `deployment/office-bridge/**`
- `scripts/uninstall-office-api-launchd.sh`
- `docs/deployment.md`
- `docs/ops/feishu-dev-handoff.md` if group IDs and handoff wording are intentionally public; otherwise redact before publishing
- `docs/task-log/**` only if they are meant to be public engineering notes
- `public/manifest.demo.webmanifest` after confirming public product naming

## Ignore / exclude from public release

These are local evidence, generated, or runtime artifacts and should not be committed to the public repo:

- `.env.local`, `.env.internal`, `.env.internal.fallback`, `.env.demo`, `.env.opensource` unless deliberately converted to examples
- `.vercel/**`
- `logs/**`
- `.evidence/**`
- `.DS_Store`
- `dist/**`
- `server/data/audit-log.json`
- `server/data/*.runtime.json`
- `public/system-test-results.json` unless the project intentionally publishes latest generated test output

## Redaction review before publishing

Check these paths carefully before public release:

- `docs/ops/feishu-dev-handoff.md`: contains Feishu handoff/group context; redact private group IDs if not intended for OSS.
- `server/officeInstances.ts`: contains Feishu chat-id-to-name mapping; keep only demo-safe names/IDs or remove private IDs before OSS release.
- `data/scheduler-memory.json`: contains generated memory/user-like records; confirm these are fixtures and not private data.
- `data/scheduler-template-pool.json`: confirm all templates are fixture/public-safe.
- `docs/task-log/**`: confirm no private token, account, group, customer, or internal ops details.
- `public/manifest.demo.webmanifest`: confirm public product naming.

## Current gate command set

Run before final publish decision:

```bash
/Users/ztl/.openclaw/bin/kotovela-hub-verify build-opensource
/Users/ztl/.openclaw/bin/kotovela-hub-verify test
/Users/ztl/.openclaw/bin/kotovela-hub-verify lint
/Users/ztl/.openclaw/bin/kotovela-hub-verify status
```

## Gate policy

A public release is allowed only when:

1. Build, tests, and lint pass.
2. No local-only artifacts remain in the candidate commit.
3. Private Feishu IDs / personal data / runtime audit data are removed or explicitly approved for publication.
4. `status` shows only intentional source/docs/config changes.
