# Status Date Tracker

Status Date Tracker is a plugin for Obsidian that records when a Markdown note
enters each project status. It works with status changes made in note
properties, Bases, Kanban views, and other plugins that update frontmatter
through Obsidian.

## How it works

When a note changes from:

```yaml
status: backlog
```

to:

```yaml
status: in-progress
```

the plugin adds or updates a property named after the new status:

```yaml
status: in-progress
in-progress: 2026-07-10
```

Dates use the device's local calendar date in `YYYY-MM-DD` format. Existing
status-date properties remain in the note as a compact transition history.

## Final statuses

Some transitions should keep their first date permanently. Add those statuses
to the plugin settings:

- The first transition adds the date if the property is absent.
- Later transitions back into that status preserve the existing property.
- Non-final status dates are updated whenever the note re-enters that status.

Configure the comma-separated list under **Settings → Status Date Tracker →
Final statuses**. The list is empty by default, so every status date is
overwritten until final statuses are configured.

## Installation

### Community Plugins

After the plugin is accepted into the Obsidian Community directory:

1. Open **Settings → Community plugins → Browse**.
2. Search for **Status Date Tracker**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js` and `manifest.json` from the latest GitHub release.
2. Create `<vault>/.obsidian/plugins/status-date-tracker/`.
3. Copy both files into that folder.
4. Reload Obsidian and enable **Status Date Tracker** under Community plugins.

## Data and privacy

- All processing happens locally inside Obsidian.
- The plugin makes no network requests.
- The plugin collects no telemetry or analytics.
- No account, payment, or external service is required.
- The plugin reads cached frontmatter and writes only the date property for a
  detected status transition.

## Compatibility

- Requires Obsidian 1.10.0 or later.
- Supports desktop and mobile.

## Development

```bash
npm install
npm run build
```

The production build creates `main.js`, which is attached to GitHub releases
but is not committed to the source repository.

## License

[MIT](LICENSE)
