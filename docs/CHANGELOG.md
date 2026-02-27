# Changelog

All notable changes to this project should be documented here.

## [Unreleased]
### Added
- Issue tracking baseline with GitHub issue templates and PR template.
- Documentation for changelog and decision logs.

### Changed
- N/A

### Fixed
- N/A

## [2026-02-27]
### Fixed
- Stabilized day/section regeneration replacement flow in `components/ItineraryView.tsx`.
- Fixed multiple TypeScript build issues found during Vercel deployments.
- Improved memo UX with inline input (removed dependency on `window.prompt`).
- Fixed map rendering iteration type issue in `components/ItineraryMap.tsx`.

### Chore
- Added ignores for local cache/build artifacts (`.npm-cache/`, `*.tsbuildinfo`).
