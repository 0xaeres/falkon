---
name: Falkon
description: Product-scoped code context backed by source evidence.
colors:
  bg: "#0a0a0a"
  s1: "#111113"
  s2: "#18181b"
  s3: "#202024"
  line: "#27272a"
  line2: "#3f3f46"
  text: "#fafafa"
  muted: "#a1a1aa"
  faint: "#8b8b93"
  blue: "#3b82f6"
  blue-soft: "rgba(59, 130, 246, 0.14)"
  amber: "#f5a524"
  amber-soft: "rgba(245, 165, 36, 0.12)"
  red: "#f87171"
  red-soft: "rgba(248, 113, 113, 0.1)"
  green: "#4ade80"
  sidebar: "#0d0d0f"
  blue-active: "#2563eb"
  primary-hover: "#dedee3"
typography:
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "1.5"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.5"
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: "1.7"
rounded:
  code: "4px"
  compact: "6px"
  navigation: "7px"
  control: "8px"
  switcher: "9px"
  panel: "12px"
  composer: "14px"
  sheet: "16px"
  pill: "999px"
spacing:
  step-4: "4px"
  step-6: "6px"
  step-8: "8px"
  step-10: "10px"
  step-12: "12px"
  step-14: "14px"
  step-16: "16px"
  step-18: "18px"
  step-20: "20px"
  step-22: "22px"
  step-24: "24px"
  step-28: "28px"
  step-32: "32px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.bg}"
  button-default:
    backgroundColor: "{colors.s2}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "38px"
  navigation-active:
    backgroundColor: "{colors.s2}"
    textColor: "{colors.text}"
    rounded: "{rounded.navigation}"
    padding: "0 10px"
    height: "34px"
  badge:
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  card:
    backgroundColor: "{colors.s1}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
  citation:
    backgroundColor: "{colors.s2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.code}"
    padding: "0 4px"
    height: "18px"
---

# Design System: Falkon

## Overview

**Creative North Star: "Category-standard developer tool"**

Falkon uses the developer-tool category standard chosen and locked on 2026-10-11. Near-black surfaces, quiet borders, compact controls, and Geist typography keep source evidence and context state readable. The approved logo and the setup, status, and chat compositions remain the visual authority.

White primary actions carry task progression. Blue identifies focus, selection, and work in progress. State color always accompanies a label; amber warnings and red failures do not compete with the main action. Code-native SVG marks and icons supply imagery. No raster asset ships.

**Key Characteristics:**

- Near-black tonal layering with hairline boundaries.
- Compact Geist UI and Geist Mono source metadata.
- White primary actions and semantic state color.
- Evidence remains attached to the answer it supports.

## Colors

The frontmatter owns the observed color values. Names mirror the CSS custom properties in `src/app/globals.css`.

### Primary

The text token supplies the white primary action. The background token supplies its dark label. Primary-hover preserves the subtle grey rollover.

### Secondary

Blue marks focus, selection, and active work. Blue-active supplies the darker fill behind white citation and evidence-tab labels. Blue-soft supplies selection halos and subdued highlights.

### Tertiary

Amber marks partial results, unresolved targets, and freshness concerns; red marks errors; green marks confirmation. Their soft fills keep notices quieter than task actions. Provider logos and syntax highlighting retain their existing domain colors rather than becoming UI accents.

### Neutral

Background anchors the page. Sidebar is a separate near-black navigation plane. S1 holds cards and evidence; s2 holds controls and selected navigation; s3 holds hover and disabled treatments. Line and line2 separate containers and controls. Text, muted, and faint establish the reading hierarchy.

**The State Color Rule.** Every state color has a readable label. Blue selection and white primary actions keep separate roles.

## Typography

Geist is the UI and prose family, with a sans-serif fallback. Geist Mono is the source and identifier family, with a monospace fallback. Both load locally through `next/font/local` in `src/app/layout.tsx`.

The frontmatter records the shared headline, title, body, label, and mono roles. Page headings use headline; setup card headings use title. Evidence pane headings and section labels use smaller semibold UI text. Answer prose increases line height and stays within 66 characters per line. Source excerpts use tabular numerals, persistent whitespace, line numbers, and restrained syntax color.

**The Source Type Rule.** Paths, product identifiers, revisions, citation numbers, and source excerpts use Geist Mono. Generation identifiers are internal and never shown; the UI names the index by its age. Interface sentences use Geist.

## Layout

A 48px top bar spans the workspace: the Falkon mark, the Product switcher, and the current page as a breadcrumb, with the verdict pill and a Connect action on the right. Below it, desktop navigation is a rail with three modes chosen from its bottom "Sidebar control" menu and remembered per browser: Expanded (256px, in the layout), Collapsed (56px icons with titles), and Expand on hover (the default: 56px, widening to 256px over the page after a 100ms intent delay or on keyboard focus, never pushing content). The rail holds Status, Chat, Search and Connect, then the chat history (visible while open), then Settings at the bottom. Below 768px, navigation becomes a 300px sheet opened from the top bar. The setup header is 48px high.

Every workspace page sits on one 12-column grid, capped at 1200px, with 24px gutters and 32px side padding (16px below 768px). Status leads with the verdict line and Sync now across all 12 columns, then six fact tiles (last indexed, repositories, code host, sync, build, knowledge base) in 8 columns beside a 4-column card of next actions, then gaps when present and the repositories table across 12. Connect puts the client tabs with numbered steps in 8 columns beside 4 columns of endpoint and tool cards. Setup uses the same grid at 1120px: a 3-column step rail beside a 9-column card; below 1024px the rail becomes a step count with a progress track. Chat has a flexible conversation beside a resizable evidence pane (34% by default, at least 340px, at most 65%) from 1280px; narrower, evidence opens in a sheet. Diagrams draw on a dark dotted canvas with pan, zoom, fit, full screen, copy and SVG download. The thread and composer are capped at 740px. Mobile history has its own drawer; evidence opens in a sheet.

Spacing follows the observed steps in the frontmatter. Use tighter gaps inside controls and wider padding between sections. Mobile setup removes the outer card boundary and uses a step count with a 3px progress track. The body scrolls within the available viewport while the footer stays pinned with safe-area padding. The repository footer shows a selected count beside the primary action. Primary buttons and regular inputs have 44px targets; branch selectors remain 38px high. Repository tables become stacked rows with inline language and revision metadata, while the separate desktop columns disappear. The verified [mobile setup screenshot](.impeccable/review/setup-mobile.jpg) records this approved responsive composition.

## Elevation & Depth

Tonal layering and one-pixel borders define everyday depth. Cards and static panes have no drop shadows. Focused fields gain soft blue rings. Global navigation uses an inset boundary. Dropdown overlays follow the supplied macOS glass reference: smoked charcoal glass with a subtle cool-to-neutral tint, 28px backdrop blur, 16px corners, a luminous boundary and inner top-edge highlight, and a deep soft offset shadow. Option highlights and separators use translucent white. Browsers without backdrop filtering retain the opaque dark surface. Shadows also belong to the mobile drawer and queued-result toasts. Their exact values are recorded in the sidecar.

Background transitions run for 150ms with ease. The evidence sheet enters over 180ms. Streaming indicators pulse. Route-level boot shows only the approved Falkon mark, centered, with its three wing bars sweeping in sequence over 1.4 seconds. Containers that load their own data (status, connect, chat, chat history, evidence, the repository picker, search results) show content-shaped skeletons that mirror the loaded layout, so nothing jumps when data arrives. No visible loading copy or artificial delay. Accessible status labels remain available. Reduced-motion settings show a static mark and still skeletons. Keep motion tied to state changes.

**The Flat Surface Rule.** Keep resting cards flat. Reserve shadows for overlays and use borders or selection rings for ordinary hierarchy.

## Shapes

Controls share modest rounded corners. Navigation is slightly tighter, panels broader, and the composer broader still. The frontmatter records their distinct observed radii. Badges and scope indicators are pills; state dots and avatars are circles. Code chips and citation markers have compact corners. The user question has an asymmetric lower corner; answer prose has no enclosing bubble.

## Components

### Buttons

Primary buttons are white with dark labels. Default buttons use a raised dark fill and visible border; ghost buttons use muted text on transparent backgrounds. All use compact spacing, medium weight, restrained hover changes, and visible keyboard focus. Busy buttons disable repeat activation. Disabled controls use subdued text and fill. Small buttons retain the existing compact variant.

### Inputs / Fields

Fields sit on the page background with a stronger border. Focus uses the muted neutral border without a halo. Errors use a red border and accompanying explanation. Labels and help text remain outside the field. The chat composer uses the same neutral focus border in a separate multiline container with a scope pill and white send button. All selection dropdowns use a shared Radix control with a padded Lucide chevron and checked options. Repository branch buttons use a neutral keyboard focus outline. Their checked-option menu opens beside the field on desktop, switches sides to avoid viewport edges, and opens below the field on mobile.

### Navigation

The selected destination uses a dark tonal fill, light text, and an inset boundary. Hover brightens the same plane. The Product switcher lives in the top bar. The rail lists Status, Chat, Search and Connect, the chat history, and Settings last, with the Status state dot riding on its icon while closed. Labels stay in the DOM and are revealed when the rail opens. On mobile the same rail content opens as a 300px sheet from the top bar.

### Chips / Tags

Badges use a quiet outline, pill silhouette, and optional state dot. Semantic variants apply matching text, border, and soft background. Citation markers use mono numbers and compact corners, with a darker blue selected fill. State labels remain readable without color.

### Cards / Containers

Components are shadcn/ui (new-york, Radix) themed through the CSS variables in `src/app/globals.css`; chat structure uses AI Elements (Conversation, Message, PromptInput, ChainOfThought, Shimmer). Cards use s1 with a subtle boundary, a bordered header strip, and no shadow; fact tiles share one hairline grid rather than floating as separate cards. Header, body, footer, and detail sections have distinct padding and dividers. No decorative shadows. Alerts use inline icon, title, and explanation; error and warning variants apply the corresponding soft fill.

### Evidence

Source excerpts preserve repository, path, revision, and line range. Cited lines use a faint blue background with a blue leading edge. Answers remain plain prose with attached citation controls; unresolved targets, abstentions, and generation changes keep their own treatments.

## Do's and Don'ts

### Do:

- Do retain the approved Falkon mark and proper source-provider logos.
- Do show state labels alongside color and keep revisions, paths, and excerpts in Geist Mono.
- Do retain keyboard focus, disabled reasons, and reduced-motion behavior.
- Do use the locked surface briefs for page composition.

### Don't:

- Don't add decorative gradients, ornamental imagery, or invented brand accents.
- Don't turn the status view into telemetry charts or metric tiles.
- Don't style predicted hints as verified source evidence.
- Don't ship synthetic data or a demo account in the app; mock data lives in tests only.
