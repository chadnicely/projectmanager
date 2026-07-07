# Updates

A running log of what's been built, newest first. See `HOST.md` for server/database setup.

## 2026-07-06

- Instant auto-link fix: URLs now link fully the moment you hit Enter/Shift+Enter
  (previous mid-typing "growing link" approach was scrapped for reliability)
- Named multiple checklists per card (Trello-style: name the checklist, then add items;
  a card can have several), with per-checklist progress bars
- Checklist names and items are click-to-edit inline
- Item popup redesigned to a single column with tabs: Description / URLs / Checklists /
  Attachments, plus a right-side Activity panel (comments + event feed merged, avatars,
  two-line entries with timestamp below)
- New URLs tab (paste a link, press Enter, click 🔗 to open, hover 🗑 to remove)
- Removed the Date/Link fields from the popup; creation date now shows as plain text
  under the title
- Cover image: small 46×26 thumbnail in the description toolbar (click for
  Change/Remove) instead of a large banner; "Cover image" button only shows when
  there's no cover yet
- Labels: replaced the 🏷 button with a dashed "＋ Add Label" chip next to the title;
  default label colors remapped from Trello's stock palette to the app's own palette
  (fixes unreadable white-on-yellow and clashing hues)
- Labels now render as chips on table rows (not just the popup/Kanban) and are
  clickable there too
- Fixed a z-index bug where popovers (Labels, cover menu, etc.) opened invisibly
  behind the item popup
- Item popup now follows the app's light/dark theme instead of always being white
- Kanban: group color now shows as a 6px bar across the top of each column instead
  of a small dot; removed the redundant Table/Board switch (the tabs already do this)
- Dark Kanban canvas simplified to flat neutral tones (no gradients); light Kanban
  simplified to match the rest of the light app (white, bordered, no special skin)
- `---` (3+ dashes) converts to a thin horizontal divider anywhere in the description,
  not just on its own line
- Fixed new items inheriting demo-style defaults (status, attachment count, date) —
  new items now start truly blank
- Fixed the group-rename bug where Kanban didn't reflect a renamed group
- Row-level delete: hover a row (Boards table or Base grid) for a red trash icon at
  the row's end
- Group colors unified to one default; per-group recoloring moved into the group's
  ⋯ menu ("Group color")
- Performance fix: localStorage writes are now debounced (was serializing the whole
  workspace on every keystroke)

## 2026-07-05

- MongoDB Atlas wired up as the real backend (`server.js` extended with a state API);
  local `localStorage` is now just an offline cache
- Login system built: signup/login/logout, scrypt password hashing, 30-day sessions,
  the whole app gated behind auth
- Team management made top-level (👥 icon in the top bar + app launcher), works from
  any app (Boards/Base/Time)
- Base: Filter (multi-condition), Find Duplicates ("Delete all but most recent" /
  "oldest"), hover-to-delete rows
- Demo mode overhaul: Demo ON = full sample data across all three apps, Demo OFF =
  guided onboarding (name your workspace → name your first board) leading to a
  genuinely blank slate
- Onboarding only ever shows once per workspace (creating additional workspaces
  later skips the wizard)
- Kanban cards redesigned Trello-style: cover images, compact label chips, checklist
  progress badges, click-anywhere-on-card to open
- GitHub repo + Render deploy config prepared (`render.yaml`, `package.json`) —
  push to GitHub and deploy step still pending (needs the user's own GitHub login)
- `Start Project Center.bat` launcher added for one-click local start

## Earlier (pre-2026-07-05)

- Cloned Plaky/Monday.com-style board UI: table + Kanban views, groups, drag-reorder,
  item drawer with comments/files/subitems/activity
- Spaces (workspaces), Team directory, Time tracker (Time Doctor-style staff view),
  Base (Airtable-style grid with 28 field types)
- Rebranded Plaky → Laneo → Cadence (final name), PWA support (installable, offline
  service worker)
