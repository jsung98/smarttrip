# Issue Tracking Guide

## Labels
- Type: `bug`, `enhancement`, `infra`, `ui`, `api`
- Priority: `P0`, `P1`, `P2`, `P3`
- Status: `todo`, `in-progress`, `review`, `done`

## Board (GitHub Projects)
Use columns:
1. Backlog
2. Todo
3. Doing
4. Review
5. Done

## Workflow
1. Create issue with template.
2. Assign labels (`Type` + `Priority` + `Status: todo`).
3. Move to `Doing` when implementation starts.
4. Open PR with `Closes #<issue-number>`.
5. On merge, issue closes automatically and card moves to `Done`.

## Branch Naming
- `feat/<short-topic>`
- `fix/<short-topic>`
- `chore/<short-topic>`

## Definition of Done
- Build passes (`npm run build`)
- Core impacted flow tested
- Changelog updated (`docs/CHANGELOG.md`)
- Decision logged if architecture/flow changed (`docs/DECISIONS.md`)
