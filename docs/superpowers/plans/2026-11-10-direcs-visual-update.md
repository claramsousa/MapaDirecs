# DIRECs Visual Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each DIREC region on the map its official color (from the reference legend image), fix the "Açu"→"Assú" name, make the hover-only number land visually centered on irregular shapes, make the hover highlight a lightened version of the region's own color, and stop the click-to-open side card from causing a layout jump.

**Architecture:** All changes live in `src/Map.jsx` plus two new small pure-function utility modules (`src/utils/svgGeometry.js`, `src/utils/colorUtils.js`) that `Map.jsx` imports. The utilities are pure (string/number in, string/number out) so they can be verified with plain Node scripts — no browser or test runner needed. The region-fill color, hover color, and hover-label position all become data-driven from a new `coresDirecs` map and from path geometry already present in `pathsSVG`, instead of the current hardcoded gray/blue and `getBBox()` call.

**Tech Stack:** React 19, Vite, Tailwind utility classes, framer-motion. No new dependencies — this project has no test runner configured (no jest/vitest), so pure-logic verification uses throwaway Node scripts in the scratchpad directory, and the visual/UX changes are verified manually by running `npm run dev` and interacting with the map in a browser.

**Spec:** No separate design doc was written — this is a small, single-file-scoped change, and the full requirements were captured and approved in chat during brainstorming (see conversation). The decisions below are restated here as the spec this plan implements:
- Hover number stays hover-only; only its *position* changes (better visual centering).
- All 16 DIREC regions get the exact hex colors sampled from `src/assets/img_ref.png`'s legend swatches (see Task 2 for the extracted table).
- Sede name "Açu" → "Assú" (11ª DIREC).
- No persistent color legend UI is added — color identification stays inside the click-to-open side card only.
- Pins / "Filtros do Projeto" panel from the reference image are explicitly out of scope.
- Side card keeps its current fields (Sede, Diretor); only its position changes, to stop it from causing a layout jump when it opens.
- Hover fill becomes a lightened version of the region's own color (not the old unrelated blue `#55C7F0`).

## Global Constraints

- No new npm dependencies.
- Do not run any git commands (no commits, no repo init) — the user explicitly asked not to commit anything this session.
- Follow the existing code style in `Map.jsx` (Portuguese variable/function names, Tailwind utility classes, framer-motion `motion.*` components).
- Do not touch the `pathsSVG` array's `d` string contents — only read them.
- Keep `infoDirecs` keyed by `"Nª DIREC"` strings exactly as today; only the `sede` value for `"11ª DIREC"` changes.

## Review Focus

- Multi-subpath (disjoint) DIREC shapes: the centroid combiner must handle several separate polygon rings per region without crashing or returning `NaN`, and should place the point at a reasonable area-weighted location rather than, say, the average of raw coordinates.
- Degenerate/zero-area input (a ring with no area, or an empty `d` string): must fall back to a safe default instead of dividing by zero and rendering `NaN` as the label position.
- `lightenHex` must clamp each channel at 255 instead of overflowing into invalid hex digits when lightening already-light colors (several DIREC colors are pale, e.g. `#FFF99C`, `#DEDEDC`).
- The `sede` rename for "11ª DIREC" must not change the lookup key (`regiao.nome` / `regiaoClicada` stays `"11ª DIREC"`) — only the displayed sede text changes, so the side card must still open correctly for that region.
- Removing the `getBBox()`-based `handleMouseEnter` must not break `handleMouseLeave` / the existing hide-on-leave behavior, and must default sanely if a region's name is ever missing from the precomputed centroid map.

---

## File Structure

- Create: `MapaDirecs/src/utils/svgGeometry.js` — pure function to compute a multi-polygon area-weighted centroid from an SVG path `d` string.
- Create: `MapaDirecs/src/utils/colorUtils.js` — pure function to lighten a hex color by a given fraction.
- Modify: `MapaDirecs/src/Map.jsx` — add color palette + name fix, wire in the two utilities, reposition the side card.

---

### Task 1: Polygon centroid utility

**Files:**
- Create: `MapaDirecs/src/utils/svgGeometry.js`
- Test (throwaway, not committed to repo): `<scratchpad>/verify-geometry.mjs`

**Interfaces:**
- Produces: `getMultiPolygonCentroid(d: string): { x: number, y: number }` — used by Task 3.

- [ ] **Step 1: Write the failing verification script**

Create a scratchpad script that imports the not-yet-existing module and asserts on four cases:

```js
import { getMultiPolygonCentroid } from "<absolute path to>/MapaDirecs/src/utils/svgGeometry.js";
import assert from "node:assert";

// 1. Single square: centroid is the geometric center.
assert.deepStrictEqual(
  getMultiPolygonCentroid("M 0 0 L 10 0 L 10 10 L 0 10 z"),
  { x: 5, y: 5 }
);

// 2. Two disjoint equal squares (far apart): centroid lands between them,
//    weighted by area (equal area here -> simple midpoint of the two centers).
const twoSquares = "M 0 0 L 10 0 L 10 10 L 0 10 z M 100 0 L 110 0 L 110 10 L 100 10 z";
assert.deepStrictEqual(getMultiPolygonCentroid(twoSquares), { x: 55, y: 5 });

// 3. Concave L-shape: centroid must NOT equal the bounding-box center (20,20),
//    proving this is better than a bbox-based approach.
const lShape = "M 0 0 L 40 0 L 40 20 L 20 20 L 20 40 L 0 40 z";
const c = getMultiPolygonCentroid(lShape);
assert.ok(!(c.x === 20 && c.y === 20), "centroid should differ from bbox center for a concave shape");

// 4. Degenerate/empty path: must not throw or return NaN.
const empty = getMultiPolygonCentroid("");
assert.ok(Number.isFinite(empty.x) && Number.isFinite(empty.y));

console.log("ALL PASS");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node <scratchpad>/verify-geometry.mjs`
Expected: FAIL — `Cannot find module '.../svgGeometry.js'`

- [ ] **Step 3: Implement `getMultiPolygonCentroid(d)` in `MapaDirecs/src/utils/svgGeometry.js`**

Approach: the `d` strings in this project only ever use `M`, `L`, and `z` (verified — no curves), so parsing is a straight tokenizer: split the string into `M`-delimited subpaths, and within each subpath collect `[x, y]` number pairs (ignore the `M`/`L`/`z` letters themselves). For each subpath (ring) with ≥3 points, compute its signed area and centroid with the standard shoelace polygon-centroid formula (wrapping the last point to the first, so an explicit trailing `z` isn't required). Weight each ring's centroid by `Math.abs(area)` and combine across all rings: `{ x: Σ(area_i * cx_i) / Σarea_i, y: Σ(area_i * cy_i) / Σarea_i }`. If the total weight is `0` (degenerate/empty input, or every ring has zero area), fall back to the arithmetic mean of every point collected (or `{ x: 0, y: 0 }` if there are no points at all).

- [ ] **Step 4: Run it to verify it passes**

Run: `node <scratchpad>/verify-geometry.mjs`
Expected: `ALL PASS`

- [ ] **Step 5: Delete the scratchpad script** (it's a throwaway check, not part of the repo)

---

### Task 2: Color lighten utility + DIREC palette/name data

**Files:**
- Create: `MapaDirecs/src/utils/colorUtils.js`
- Modify: `MapaDirecs/src/Map.jsx:5-21` (the `infoDirecs` block)
- Test (throwaway): `<scratchpad>/verify-color.mjs`

**Interfaces:**
- Produces: `lightenHex(hex: string, amount: number): string` — used by Task 3's hover fill.
- Produces (in `Map.jsx`): a module-level `const coresDirecs = { "1ª DIREC": "#41909A", ... }` object, one entry per DIREC name exactly matching the keys already used in `infoDirecs` / `regiao.nome`.

- [ ] **Step 1: Write the failing verification script**

```js
import { lightenHex } from "<absolute path to>/MapaDirecs/src/utils/colorUtils.js";
import assert from "node:assert";

assert.strictEqual(lightenHex("#000000", 0.5), "#808080");
assert.strictEqual(lightenHex("#FFF99C", 0.25), "#FFFBB5"); // R channel already 255: must clamp/no-op, not overflow
assert.strictEqual(lightenHex("#41909A", 0), "#41909A"); // amount 0 is a no-op

console.log("ALL PASS");
```

(Compute the exact expected string for the second/third assertions from the formula in Step 3 before writing them, so the test encodes the real formula and not a guess.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node <scratchpad>/verify-color.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lightenHex(hex, amount)` in `MapaDirecs/src/utils/colorUtils.js`**

Parse the 6-digit hex into R/G/B integers, move each channel toward 255 by `amount` (`channel + (255 - channel) * amount`), round, clamp to `[0, 255]`, and re-encode as a zero-padded 2-digit uppercase hex string prefixed with `#`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node <scratchpad>/verify-color.mjs`
Expected: `ALL PASS`

- [ ] **Step 5: Delete the scratchpad script**

- [ ] **Step 6: Add the `coresDirecs` palette and fix the "Açu" name in `Map.jsx`**

Add immediately after the `infoDirecs` block (after line 21):

```js
const coresDirecs = {
  "1ª DIREC": "#41909A",
  "2ª DIREC": "#8D4170",
  "3ª DIREC": "#B7DCCA",
  "4ª DIREC": "#98956C",
  "5ª DIREC": "#FFF99C",
  "6ª DIREC": "#7A7198",
  "7ª DIREC": "#E87878",
  "8ª DIREC": "#97AEBE",
  "9ª DIREC": "#87C127",
  "10ª DIREC": "#007CC2",
  "11ª DIREC": "#DA251D",
  "12ª DIREC": "#FFF420",
  "13ª DIREC": "#E77917",
  "14ª DIREC": "#DEDEDC",
  "15ª DIREC": "#01923F",
  "16ª DIREC": "#485778",
};
```

In the existing `infoDirecs` object, change the `"11ª DIREC"` entry's `sede` from `"Açu"` to `"Assú"` (the key `"11ª DIREC"` itself is unchanged).

- [ ] **Step 7: Visually confirm** by reading the edited lines back and checking all 16 keys in `coresDirecs` match the 16 keys already in `infoDirecs` exactly (same accents/ordinal characters).

---

### Task 3: Wire the palette, lighten, and centroid into the rendered map

**Files:**
- Modify: `MapaDirecs/src/Map.jsx` (imports, `handleMouseEnter`/`handleMouseLeave`, the `pathsSVG.map(...)` render, the hover `<text>`)

**Interfaces:**
- Consumes: `getMultiPolygonCentroid(d)` from Task 1, `lightenHex(hex, amount)` and `coresDirecs` from Task 2.

- [ ] **Step 1: Update imports**

Change line 2 from `import { useState } from "react";` to `import { useState, useMemo } from "react";`, and add:
```js
import { getMultiPolygonCentroid } from "./utils/svgGeometry";
import { lightenHex } from "./utils/colorUtils";
```

- [ ] **Step 2: Precompute centroids once**

Inside `Map()`, after the existing `useState` calls, add:
```js
const centroides = useMemo(
  () => Object.fromEntries(pathsSVG.map((r) => [r.nome, getMultiPolygonCentroid(r.d)])),
  []
);
```

- [ ] **Step 3: Simplify `handleMouseEnter` to use the precomputed centroid**

Replace the current `getBBox()`-based body with:
```js
const handleMouseEnter = (nome) => {
  const centro = centroides[nome] ?? { x: 0, y: 0 };
  setHoverInfo({ nome, x: centro.x, y: centro.y });
};
```
(Drop the `e`/event parameter — it's no longer needed.)

- [ ] **Step 4: Update the call site**

Change `onMouseEnter={(e) => handleMouseEnter(e, regiao.nome)}` to `onMouseEnter={() => handleMouseEnter(regiao.nome)}`.

- [ ] **Step 5: Apply the per-DIREC fill and lightened hover fill**

Change:
```js
initial={{ fill: "#444444", scale: 1 }}
whileHover={{ fill: "#55C7F0", scale: 1.02 }}
```
to:
```js
initial={{ fill: coresDirecs[regiao.nome] ?? "#444444", scale: 1 }}
whileHover={{ fill: lightenHex(coresDirecs[regiao.nome] ?? "#444444", 0.25), scale: 1.02 }}
```

- [ ] **Step 6: Manual verification — run the app**

Run: `npm run dev` (from `MapaDirecs/`), open the printed local URL in a browser.
Expected: all 16 regions render in their distinct legend colors (no more flat gray); hovering a region brightens that same color instead of turning blue; hovering an irregularly shaped region (e.g. one with a notch or a thin arm) shows the number sitting visibly inside the shape rather than near an edge or outside it; clicking still opens the side card with the correct Sede/Diretor, and the 11ª DIREC card now reads "Assú".

---

### Task 4: Reposition the side card to stop the layout jump

**Files:**
- Modify: `MapaDirecs/src/Map.jsx` (the card's `motion.div` className, around the current `top-24 right-8`)

- [ ] **Step 1: Change the card's position classes**

Change `className="fixed top-24 right-8 bg-white text-gray-900 p-6 rounded-xl shadow-2xl z-50 w-80"` to `className="fixed top-1/2 right-8 -translate-y-1/2 bg-white text-gray-900 p-6 rounded-xl shadow-2xl z-50 w-80"` — this vertically centers the card in the viewport instead of pinning it near the top, where it was colliding with the page title area and triggering the reported resize/jump.

- [ ] **Step 2: Manual verification — run the app and confirm no jump**

Run: `npm run dev` (if not already running from Task 3).
In the browser, click several different DIREC regions in a row and confirm: the card appears vertically centered on the right side, the rest of the page (title, map) does not visibly shift/resize when the card opens or closes, and there is no new scrollbar appearing/disappearing.
If a jump still occurs, inspect whether a horizontal scrollbar is being introduced (check `document.documentElement.scrollWidth` vs `window.innerWidth` in the browser console before/after opening the card) and adjust `right-8` to a value that fits within the viewport with the `w-80` card, or swap `w-screen` on the outer container for `w-full` if the scrollbar-width quirk is confirmed as the cause.

---

## Self-Review Notes

- Spec coverage: all six bullet points under **Spec** map to a task — numbers (Task 1/3), colors+name (Task 2/3), no legend/no pins (nothing to build, confirmed as non-goals, no task needed), card fields unchanged (Task 4 only touches position), hover-lightens-own-color (Task 2/3).
- Step scan: each implementation step names the exact file, exact function signature, and the formula/approach where the signature doesn't fully determine it; no step says "handle edge cases" without naming the case.
- Type consistency: `getMultiPolygonCentroid` and `lightenHex` signatures are declared once in Tasks 1–2 and referenced (not redefined) in Task 3.
- Review Focus: all five items each have an explicit assertion or manual-check step in the task that owns that code (Task 1 Steps 1/3 for disjoint shapes and degenerate input, Task 2 Step 1 for clamping, Task 2 Step 6/7 and Task 3 Step 6 for the sede-key/display distinction, Task 3 Steps 2–4 for the safe-default on missing centroid).
