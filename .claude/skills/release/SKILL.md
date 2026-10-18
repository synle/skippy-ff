---
name: release
description: Trigger a Skippy release. Use for any request to release, publish, ship, cut a version, create release artifacts, or run a release workflow.
---

# Release

Release without asking routing or confirmation questions when the requested action is clear.

## Release mode

- Default to **official** for every release request.
- Use **beta** only when the user explicitly says `beta`, `prerelease`, `pre-release`, `test release`, `test build`, or names `release-beta.yml`.
- Words such as `release`, `publish`, `ship`, `latest`, `current`, `new version`, or a version number do not imply beta.
- Never infer beta from the current branch, commit SHA, dirty state, failed CI, or uncertainty.

## Summary and changesets

Before triggering either workflow:

1. Resolve the latest official GitHub release whose `isDraft` and `isPrerelease` values are both false.
2. Read commits from that release tag through the release commit.
3. Summarize those changes for the user, grouped by user-visible behavior, fixes, and maintenance when applicable.
4. Continue automatically. Do not ask the user to confirm the summary, mode, SHA, notes, or version.

The summary is informational only. Do not create or edit a changeset, changelog, release body, generated notes file, or static release-body file. Do not pass `notes`, `release_notes`, `user_notes`, or equivalent custom-note input to a workflow. Leave those inputs unset so the repository workflow generates its changelog from commits since the last official release.

## Official release

1. Verify `main` is clean, validated, and synchronized with `origin/main`.
2. Check for an in-progress official release. If one exists, report its URL and stop without triggering a duplicate.
3. Push committed changes after `git pull --rebase`.
4. Trigger `release-official.yml` without the `notes` input. The workflow owns the minor version bump and generated release notes.
5. Report the official version, summarized changes, workflow URL, release URL, and final result.

## Beta or test release

Only enter this path after an explicit beta/test marker.

1. Resolve the requested SHA, defaulting to current `HEAD` only when none was supplied.
2. Check for an in-progress beta release. If one exists, report its URL and stop.
3. Ensure the release commit exists on the remote.
4. Trigger `release-beta.yml`, supplying `sha` only when needed and leaving `notes` unset.
5. Report the SHA, expected beta tag, summarized changes since the last official release, workflow URL, release URL, and final result.
