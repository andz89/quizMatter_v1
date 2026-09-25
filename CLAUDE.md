# Workflow Preferences

Whenever a requested feature or adjustment would change the structure or behavior of the app (new data flow, new component/module, schema change, new dependency, altered logic), do NOT write code first. First reply with a plan: describe the structure/architecture you intend to build, walk through the logic in detail, and explicitly call out any external or internal library you plan to use. Wait for the user to review and approve the plan before implementing.

# Installing Packages (npm version)

The app deploys on Cloudflare Workers Builds, which runs `npm ci` with **npm 10.9.2**. The user's machine has npm 11, which writes a `package-lock.json` that npm 10's `npm ci` rejects ("package.json and package-lock.json are not in sync") and the deploy fails.

So whenever you add, remove, or update a package, always use npm 10.9.2 instead of plain `npm`:

- Add: `npx -y npm@10.9.2 install <package>` (dev: `npx -y npm@10.9.2 install -D <package>`)
- Remove: `npx -y npm@10.9.2 uninstall <package>`
- Any other change to `package.json` dependencies: run `npx -y npm@10.9.2 install` afterwards to rewrite the lock file

Do this yourself — don't ask the user to run it. Commit `package-lock.json` together with `package.json`.

# Code Style

Keep the code:

- Simple and readable
- Well-structured without over-engineering
- Optimized where it actually matters
- Easy to maintain and modify
- Free of unnecessary abstractions, hooks, utilities, or patterns unless they provide a real benefit

# Communication Style

When explaining things to the user (in chat replies, comments, or docs), use plain, simple, basic English — short words and short sentences over technical jargon. If a difficult or technical term is unavoidable, add a simpler synonym right after it and give a concrete example. For instance: "memoize (means: remember a result so it doesn't have to be recalculated) — e.g. caching a math answer instead of redoing the calculation every time."

# Task Tracker — Design System

Extracted from the reference screenshot: colors, spacing, radius, and typography.

## Overall Style

Simple but elegant — minimal, uncluttered, and calm rather than flashy:

- **Low visual noise:** almost no shadows or gradients; elevation comes purely from a white card sitting on a warm cream background, not from heavy drop shadows
- **Soft, not sharp:** consistently rounded corners (8–14px) everywhere — cards, buttons, pills, inputs — nothing sharp-edged, which keeps it feeling friendly and light
- **Restrained color palette:** mostly neutral grays/creams/whites, with color used sparingly and only for meaning (green = success, orange = in-progress, navy = primary action) — not for decoration
- **Generous whitespace:** comfortable padding and row height rather than a dense, cramped table — gives it a breathable, premium feel
- **Quiet typography:** no bold/loud headlines; hierarchy is built with small size and weight shifts (12px uppercase labels vs. 14px body vs. 15-16px headings) instead of big contrast jumps
- **Consistent, thin iconography:** all icons share the same thin stroke weight and use `--text-primary` (near-black), so they read clearly instead of washing out — muted gray was tried and felt too low-contrast
- **Function over decoration:** every visual element (pill colors, icons, spacing) serves to communicate status or structure — nothing is purely ornamental

This restraint is what reads as "elegant" — it's a plain, muted palette and simple shapes, but applied with consistency and enough whitespace that it doesn't feel cheap or cluttered.

## Colors

### Background & Surfaces
| Token | Value | Usage |
|---|---|---|
| `--bg-page` | `#FAF9F6` | Page background (warm off-white, not pure white) |
| `--bg-surface` | `#FFFFFF` | Card / table surface |
| `--border-default` | `#E8E6E1` | Row dividers, input borders |

### Text
| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#1F1F1F` | Headings, primary content |
| `--text-secondary` | `#9B9994` | Placeholders, muted values ("—") |
| `--text-header` | `#A8A6A1` | Column headers (uppercase) |

### Accent / Brand
| Token | Value | Usage |
|---|---|---|
| `--accent-navy` | `#191A2C` | Primary buttons ("+ Add Task") |
| `--accent-green` | `#1E8E4F` | Success states, "+ Add Group" text link |
| `--accent-orange` | `#F2A93B` | "In Progress" status pill |
| `--accent-gray` | `#A8A6A1` | "Not Started" status pill |

## Typography

- **Font family:** Humanist sans-serif (Inter / system-ui)

| Element | Weight | Size | Notes |
|---|---|---|---|
| Page/group heading | Semibold | 15–16px | e.g. "Ungrouped tasks" |
| Column headers | Bold | 11–12px | Uppercase, `letter-spacing: 0.05em`, gray |
| Body / table text | Regular | 14px | Default cell text |
| Buttons | Semibold | 14px | "+ Add Task", "+ Add Group" |
| Status pill text | Semibold | 13px | Inside dropdown pills |
| Count badges | Regular | 14px | e.g. "(2)", "(3)", muted gray |

## Spacing & Layout

- Card padding: **16–20px** horizontal, **12–14px** vertical
- Row height: **48–56px**
- Vertical gutter between sections: **16–20px**
- Icon-to-label gap: **12px**

## Corner Radius

| Element | Radius |
|---|---|
| Cards / table containers | 12–14px |
| Buttons | 8–10px |
| Status dropdowns | 6–8px |
| Search inputs | 8px |
| Small icon buttons | ~0px (icon only) |

## Other Details

- **Borders:** 1px solid hairline, `--border-default`, used for row separators and input outlines
- **Shadows:** none/minimal — elevation comes from white-card-on-cream contrast
- **Icons:** thin stroke (~1.5px), `--text-primary` color, ~16px size
- **Drag handles:** dotted grip icon, light gray, left-aligned
- **Status dropdowns:** filled background matching status color (not outlined)
- **Expand/collapse chevrons:** simple caret, gray, rotates on toggle

## CSS Variables Reference

```css
:root {
  /* Colors */
  --bg-page: #FAF9F6;
  --bg-surface: #FFFFFF;
  --border-default: #E8E6E1;

  --text-primary: #1F1F1F;
  --text-secondary: #9B9994;
  --text-header: #A8A6A1;

  --accent-navy: #191A2C;
  --accent-green: #1E8E4F;
  --accent-orange: #F2A93B;
  --accent-gray: #A8A6A1;

  /* Radius */
  --radius-card: 14px;
  --radius-button: 10px;
  --radius-dropdown: 8px;
  --radius-input: 8px;

  /* Spacing */
  --space-card-x: 20px;
  --space-card-y: 14px;
  --row-height: 52px;
  --gutter-section: 20px;
}
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
