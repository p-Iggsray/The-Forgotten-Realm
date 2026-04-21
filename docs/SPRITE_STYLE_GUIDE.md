# The Forgotten Realm — Humanoid Sprite Style Guide

Canonical spec for all humanoid characters: the four player classes (Warrior, Rogue, Wizard,
Cleric) and all village NPCs. Dungeon monsters (Shade, Lurker) are exempt.

The authoritative worked example is `_buildCharFrame()` in [render.js](../static/js/render.js).

---

## 1. Authoring Resolution and Display Scaling

Player sprites are drawn onto a fixed **64 × 64** offscreen canvas (`PLAYER_SPRITE_SIZE = 64`).
This is the authoring resolution — it never changes regardless of window size or tile size.

At display time the sprite is scaled to **TS × TS** (the current tile size, 32–64px) via
`ctx.drawImage(frame, sx, sy, TS, TS)` with `imageSmoothingEnabled = false` on every context
that touches the sprite. This gives nearest-neighbor scaling: crisp at every size, consistent
across all viewport dimensions.

**Why fixed resolution:** designs authored at a variable TS × TS size degrade unpredictably —
a 3px feature at TS=48 rounds to 2px at TS=32, sometimes to 0. Fixed authoring gives the design
a stable canvas. Scaling is the renderer's problem, not the designer's.

**NPC sprites** currently use the circle-based path and do not use `PLAYER_SPRITE_SIZE`. When
NPC pixel-art work begins (Pass 2), a separate `NPC_SPRITE_SIZE` constant will be introduced
following the same pattern.

`imageSmoothingEnabled = false` on every offscreen canvas context. Sub-pixel coordinates are
never used; all values pass through `Math.floor()`.

Cache entries are 64×64 canvases. The cache key is `"charClass|facing|frameIdx"` — TS is not
part of the key because the authoring resolution is fixed. The cache is invalidated only on
class change, never on window resize.

---

## 2. Proportions

All measurements are expressed as fractions of `PSZ` (64) via the alias `const PSZ = PLAYER_SPRITE_SIZE`.
Concrete pixel values at PSZ=64 are listed for reference.

| Region | Width | Height | Y position (top) | At PSZ=64 |
|--------|-------|--------|-----------------|-----------|
| Head | `headR × 2` (`PSZ × 0.29`) | same | `PSZ × 0.22 − headR` | 18 × 18, y=5 |
| Body (torso) | `PSZ × 0.44` | `PSZ × 0.32` | `PSZ × 0.40` | 28 × 20, y=25 |
| Shoulders (each) | `PSZ × 0.08` | `bodyH × 0.55` | `bodyY + U` | 5 × 11 |
| Legs (each) | `PSZ × 0.12` | `PSZ × 0.22` | `bodyY + bodyH − 1` | 7 × 14, y=44 |
| Cloak | `bodyW + cloakFlare × 2` | extends below legs by `U` | `bodyY + bodyH × 0.35` | 44 × 30 |

where `U = floor(PSZ / 16)` — the minimum pixel unit (4 px at PSZ=64).

**Head-to-body ratio**: head diameter (18px) is ~64% of torso width (28px).  
**Cloak flare**: `max(U×2, floor(PSZ × 0.10))` = 8px beyond each torso edge at PSZ=64.

Walk-cycle bob: frames 1, 3, and 5 shift the entire character up by `Math.max(1, floor(PSZ/32))`
= 2px at PSZ=64. This scales appropriately if `PLAYER_SPRITE_SIZE` is ever changed.

---

## 3. Palette Structure

### Per-class palette (`_CHAR_PALETTES` in render.js)

Each class entry has exactly these named slots:

| Slot | Purpose |
|------|---------|
| `armor` | Main torso fill — the class's identity colour |
| `armorHi` | Lighter highlight for top-left bevel edges |
| `armorSh` | Darker shadow for bottom-right bevel edges and shoulder fill |
| `cloak` | Cloak base (near-black, class-tinted) |
| `cloakEdge` | 1 px slightly lighter edge stripe on cloak sides |
| `cloakLining` | 1 px inner lining stripe, slightly lighter than cloak, on inner cloak edges |
| `cloakFold` | Fold line colour — darker than cloak base, used for 1px vertical crease lines |
| `collar` | Collar accent strip (1 U tall, inside the torso top) |
| `belt` | Belt line colour — 1px horizontal accent at waist |
| `buckle` | Belt buckle fill (2 × 2px centred at waist) |
| `legs` | Leg/pants fill |
| `boots` | Bottom U-strip of each leg (near-black) |
| `bootSole` | 1px sole line below boots (`_CHAR_OUTLINE` is acceptable) |
| `helmet` | Helmet/headwear main fill |
| `helmetHi` | Helmet single-pixel highlight row (very top) |

**Rule**: no raw hex strings inside `_buildCharFrame` or any NPC draw function.
Every colour reference resolves to a named palette slot or one of the shared constants below.

New palette slots added in this pass: `cloakLining`, `cloakFold`, `belt`, `buckle`, `bootSole`.
Pass 2 (NPC work) should reference these slots when they apply to NPCs.

### Shared constants (all classes)

```
_CHAR_SKIN    = '#c8a882'   warm parchment
_CHAR_SKIN_HI = '#ddc09a'   1-px highlight (top/left of head)
_CHAR_SKIN_SH = '#a07858'   1-px shadow (bottom/right of head), mouth hint, nose dot
_CHAR_HAIR    = '#2a1a0a'   dark brown (hair band + sideburns)
_CHAR_HAIR_HI = '#3d2a10'   1-px hair highlight (top row of band) — NEW
_CHAR_OUTLINE = '#1a1208'   silhouette outline (near-black)
_CHAR_EYE_W   = '#e8e0d0'   warm white (eye whites)
_CHAR_EYE_D   = '#281808'   dark brown (pupils)
```

New shared constant: `_CHAR_HAIR_HI` — a lighter brown for the top highlight row of the
hair band. Must be added to the constants block in render.js.

---

## 4. Light Source

**Top-left**. Consistent across all body parts.

| Edge | Colour |
|------|--------|
| Top and left of torso | `armorHi` |
| Bottom and right of torso | `armorSh` |
| Top and left of head | `_CHAR_SKIN_HI` |
| Bottom and right of head | `_CHAR_SKIN_SH` |
| Top of helmet | `helmetHi` |
| Shoulders | `armorSh` fill (side-facing, less direct light) |
| Cloak fold lines | `cloakFold` (darker than base — facing away from light) |
| Cloak inner lining | `cloakLining` (lighter than base — facing inward toward character) |

No body part is shaded from a different direction. No gradients — only flat fills with
single-pixel bevel rows.

---

## 5. Outline Rule

**Selective silhouette outline only** — 1 px of `_CHAR_OUTLINE` on external edges. No heavy
outlines on internal boundaries between body parts.

Applied edges (drawn before fills so the fill overwrites the interior):
- All 4 sides of the head bounding box
- Left side, right side, and bottom of the body+shoulders (height includes legs)
- Bottom of the feet

Not outlined:
- Head-to-body junction
- Cloak edges (cloak colour is dark enough to be self-outlining)
- Any joint between body regions that don't face the silhouette

---

## 6. Head Shape

**Pixel-art rounded rect (octagon via double fillRect)** — not `arc()`.

```
  xxxxxxxxxxxxxxxxx     ← headW − 2
xxxxxxxxxxxxxxxxxx      ← headW (full)
xxxxxxxxxxxxxxxxxx
  ...
  xxxxxxxxxxxxxxxxx
```

Achieved by two overlapping `fillRect` calls:
1. `fillRect(headX+1, headY, headW−2, headH)` — top/bottom rows narrower
2. `fillRect(headX, headY+1, headW, headH−2)` — left/right rows full

At PSZ=64, headW=18: top/bottom rows are 16px wide, giving a clean 1-corner-cut at all four
corners. Never use `arc()` for humanoid heads — it introduces anti-aliasing.

---

## 7. Face Features

Face detail is direction-dependent. All eye sizes are **hard-coded pixel counts**, not derived
from `U` or any other scaling variable. This prevents the oversized-blob problem at PSZ=64.

### Eye specification (hard pixel values, not U-derived)

| Facing | Whites | Pupils | Position guidance |
|--------|--------|--------|-------------------|
| South | Two 2×2 whites | One 1×1 pupil each, bottom-inside corner | Left: `cx−4`, right: `cx+2`. 2px gap between. |
| East/West | One 2×2 white | One 1×1 pupil, inner edge | Near side of face: ~4px from face centre. |
| North | None | None | Full hair coverage. |

Eyes must never overlap. Minimum 2px horizontal gap between eye whites when facing south.
The 2×2 specification guarantees 1-pixel readability at TS=32 (2px at 64 → 1px at 32).

### Mouth
A **2×2** dark hint (`_CHAR_SKIN_SH`) at approximately `(cx−1, headCY + floor(headH×0.35))`.
2px tall is required — a 1px mouth disappears at nearest-neighbor downscale to TS=32.

### Nose
A **1×1** dot (`_CHAR_SKIN_SH`) at `(cx, headCY + floor(headH×0.20))`. Optional — use only
for front-facing. Omit for side and back. The 1px nose is acceptable at TS=32 (may vanish at
exact TS=32, but the face reads without it).

**Rule**: no more than two eyes, one nose dot, and one mouth hint per facing. No eyebrows,
no eyelashes, no additional face elements.

---

## 8. Hair / Headwear Treatment

**Hair band**: covers top `floor(headH × 0.42)` = 7px rows, using the corner-cut octagon
technique. A **1px highlight row** (`_CHAR_HAIR_HI`) at the very top of the band conveys the
hair's rounded surface meeting the light. Two 1-px sideburn strips descend `floor(headH×0.25)`
= 4px below the hair band on each side of the face.

**Minimum strand width**: any hair detail must be ≥ 2px wide to survive downscale to TS=32.
The highlight row is 1px and is acceptable to degrade — it is not a primary feature.

The helmet strip (`P.helmet`, `P.helmetHi`) is drawn on top of the hair at the very top of
the head, `floor(headH × 0.28)` = 5px tall. Its `helmetHi` row is always the topmost pixel.

**For hooded NPCs**: replace the helmet strip with a hood colour over the hair.
**For bare-headed NPCs**: omit the helmet strip.
**No gradients** in hair or headwear. Maximum two colours (base + highlight) per region.

---

## 9. Clothing Detail

### Belt and buckle

A **1px belt line** (`P.belt`) at `bodyY + bodyH − 4` (4px above leg join) spans the torso
width. A **2×2 buckle** (`P.buckle`) is centred at `cx` on that row. The belt and buckle are
accent elements — they sit above the existing body shading and are drawn after the body bevel.

**Minimum viability**: belt line must be 1px tall at PSZ=64. At TS=32 downscale it may vanish,
but the body silhouette reads without it. Do not increase to 2px — it disrupts the body shading.

### Boot sole

A **1px sole line** (`P.bootSole`, or `_CHAR_OUTLINE`) immediately below the boot strip
(at `legTopY + legH`). This is the contact line between boot and ground. 1px at 64 → 0–1px
at TS=32 (acceptable degradation — feet read from boot colour alone).

---

## 10. Cloak Detail

The cloak is the largest surface area on the sprite (≈ 1320px² at PSZ=64). It must not be a
flat fill.

**Required details:**
1. **Two fold lines** — 1px vertical `P.cloakFold` lines at approximately 30% and 70% of
   cloak width, running from `cloakTopY+2` to `cloakBotY−2`. These suggest fabric draping.
2. **Inner lining** — 1px `P.cloakLining` strip on the inner edge of each side
   (`cloakX+1` and `cloakX+cloakW−2`), running the full cloak height. This reads as the
   lighter interior of the cloak.

The outer edge strips (`P.cloakEdge`) remain at `cloakX` and `cloakX+cloakW−1` as before.
Draw order from outer to inner: `cloakEdge`, `cloakLining`, `cloakFold`.

**Minimum feature sizes**: both fold lines and lining strips are 1px wide. At TS=32 they may
vanish, leaving the flat cloak — that is acceptable. At TS=48+ they must be clearly visible.

---

## 11. Animation Frames

6 frames per direction: walk cycle (0–3) + idle bob (4–5).

| Frame | Bob | Legs |
|-------|-----|------|
| 0 | none | neutral |
| 1 | −2px | left forward, right back |
| 2 | none | neutral |
| 3 | −2px | left back, right forward |
| 4 | none | idle neutral |
| 5 | −2px | idle neutral |

Bob amplitude: `Math.max(1, Math.floor(PSZ / 32))` = 2px at PSZ=64. Formula is used in
code — do not hardcode 2.

Player walk: `frameIdx = floor(abs(walkPhase)) % 4`  
Player idle: `frameIdx = 4 + (floor(timeMs / 166) % 2)`

NPCs use the circle-based path in `drawCharacter()` and do not share this frame system until
Pass 2.

---

## 12. Minimum Feature Sizes for TS=32 Readability

The sprite is downscaled to TS=32 (0.5× from PSZ=64) at small window sizes. Nearest-neighbor
downscaling means a 2px feature at 64 becomes a 1px feature at 32, and a 1px feature may
disappear entirely.

| Feature | Minimum width at PSZ=64 | Survives to TS=32? |
|---------|------------------------|-------------------|
| Eye whites | 2×2 | Yes (becomes 1×1) |
| Mouth hint | 2×2 | Yes (becomes 1×1) |
| Nose dot | 1×1 | No — acceptable, face reads without it |
| Hair highlight row | 1px | No — acceptable |
| Belt line | 1px | No — acceptable |
| Buckle | 2×2 | Yes (becomes 1×1) |
| Cloak fold lines | 1px | No — acceptable |
| Cloak inner lining | 1px | No — acceptable |
| Boot sole | 1px | No — acceptable |
| Body bevel rows | 1px | No — acceptable at small size |
| Collar strip | U=4px | Yes (becomes 2px) |
| Boot strip | U=4px | Yes (becomes 2px) |
| Shoulder panels | 5px | Yes (becomes ~2px) |

**Rule**: any feature that must remain legible at TS=32 requires ≥ 2px width at PSZ=64.
Features that provide enhancement only (fold lines, sole line, nose) may be 1px and are
allowed to disappear at small sizes.

---

## 13. Accessory Treatment

Weapons and tools are drawn by `drawWeapon()` in the live render context (not cached),
overlaid on top of the blitted sprite. Weapon positioning uses TS-based coordinates
(`cx = sx + TS/2`, `r = TS * 0.28`) — these are screen-space values, not authoring-space.

For NPC-specific props (Pass 2): draw as additional `fillRect` calls in the NPC's own draw
function. Props use palette slots from `_CHAR_PALETTES` or shared constants.

**Rule**: no prop colour outside the class palette or shared constants without first adding it
to both.

---

## 14. Colour Variation for Distinctness

Different characters are distinguished by:
1. Their entry in `_CHAR_PALETTES` — swaps `armor`, `cloak`, `collar`, `legs`, and new slots
2. Skin tone: `_CHAR_SKIN` default, or a named override constant
3. Hair colour: `_CHAR_HAIR` default, or a named override constant
4. Props and accessories

What does NOT change: proportions, shading direction, outline rule, head shape, face feature
count. These are invariants. If two characters look too similar, change their palette.

---

## 15. Negative Rules

- **No `arc()` for humanoid heads.** Only `fillRect`.
- **No raw hex strings in draw functions.** All colours through named palette slots.
- **No gradient fills.** One flat colour per region, with single-pixel bevel rows for shading.
- **No light source other than top-left.** Every bevel follows the same convention.
- **No outlines on internal boundaries.** Outlines only at silhouette edges.
- **No per-class geometry changes.** All four classes use the same proportions.
- **No U-derived eye sizes.** Eye whites are hard-coded 2×2. Pupils are hard-coded 1×1.
- **No face elements beyond the spec.** Two eyes max, one nose dot, one mouth hint.
- **No TS references inside `_buildCharFrame`.** Use `PSZ` / `PLAYER_SPRITE_SIZE` only.
- **No draw calls inside the hot render loop.** Always cache via `_buildCharFrame()`.
- **No features < 1px.** All coordinates are integers via `Math.floor()`.

---

## 16. Worked Example — Warrior Facing South, Frame 0

```javascript
// charClass = 'Warrior'  →  P = _CHAR_PALETTES.Warrior
// PSZ = 64, U = 4, bob = 0, facing = 'down', frameIdx = 0

// Geometry (exact values at PSZ=64):
//   headR=9, headW=18, headH=18, headX=23, headY=5, headCY=14
//   bodyW=28, bodyH=20, bodyX=18, bodyY=25, sW=5
//   legW=7, legH=14, legTopY=44, leftLegX=22, rightLegX=35
//   cloakX=10, cloakW=44, cloakTopY=32, cloakBotY=62

// Step 1 — ground shadow: 25×3 black ellipse at y=53                  ← no palette rule
// Step 2 — cloak base: P.cloak at (10,32,44,30)                       ← P.cloak
//           outer edge strips: P.cloakEdge at x=10 and x=53           ← P.cloakEdge
//           inner lining: P.cloakLining at x=11 and x=52              ← P.cloakLining  NEW
//           fold lines: P.cloakFold at x=23 and x=41, y=34..60        ← P.cloakFold   NEW
// Step 3 — legs: P.legs fill; P.boots U-strip at bottom               ← P.legs, P.boots
//           boot sole: P.bootSole 1px at legTopY+legH                 ← P.bootSole    NEW
// Step 4 — silhouette outline: _CHAR_OUTLINE at head/body edges        ← outline rule §5
// Step 5 — body: P.armor fill; P.armorSh shoulders; P.collar strip    ← P.armor/Sh/collar
//           bevel: P.armorHi top+left, P.armorSh bottom+right         ← light source §4
//           belt: P.belt 1px at bodyY+bodyH−4                         ← P.belt        NEW
//           buckle: P.buckle 2×2 at (cx−1, bodyY+bodyH−4)            ← P.buckle      NEW
// Step 6 — head fill: _CHAR_SKIN octagon                              ← head shape §6
// Step 7 — head bevel: _CHAR_SKIN_HI top+left, _CHAR_SKIN_SH bot+right ← light source §4
// Step 8 — hair band: _CHAR_HAIR top 7 rows + 4px sideburns           ← hair §8
//           hair highlight: _CHAR_HAIR_HI top row of band             ← §8            NEW
//           eyes (facing=down): _CHAR_EYE_W 2×2 at (cx−4,eyeY) and (cx+2,eyeY) ← face §7
//           pupils: _CHAR_EYE_D 1×1 at bottom-inside of each white    ← face §7
//           nose: _CHAR_SKIN_SH 1×1 at (cx, headCY+3)                ← face §7       NEW
//           mouth: _CHAR_SKIN_SH 2×2 at (cx−1, headCY+6)             ← face §7
// Step 9 — helmet: P.helmet fill, P.helmetHi top row                  ← P.helmet/Hi
```

To add a new humanoid character:
1. Add an entry to `_CHAR_PALETTES` with all 15 required slots.
2. Call `_buildCharFrame(newClassName, facing, frameIdx)`.
3. Nothing else changes.
