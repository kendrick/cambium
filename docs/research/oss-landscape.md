# OSS Landscape for Cambium

Survey date: 2026-09-16. Everything below was checked against the npm registry API, the package's own repository and source, or the specification that owns the claim. Bundle sizes were measured locally, not quoted from a size badge.

## How the Sizes Were Measured

Every figure in the tables comes from the same command, run against a real install of the exact version listed:

```
esbuild <entry> --bundle --minify --format=esm --platform=browser --target=es2022
gzip -9
```

The entry file imports only the symbols Cambium would actually use. That matters: for several packages the difference between "import the whole thing" and "import what you need" is nothing at all, and a size badge will not tell you which case you are in.

## Summary

| Area | Package | Version | Published | License | Gzip | Verdict |
|---|---|---|---|---|---|---|
| 1. Color math | `culori` | 4.0.2 | 2025-06-27 | MIT | 8.0 kB | **Adopt**—foundation layer |
| 1. Color math | `colorjs.io` | 0.7.1 | 2026-07-24 | MIT | 19.0 kB | **Avoid**—will not tree-shake |
| 1. Color math | `chroma-js` | 3.2.0 | 2025-11-28 | BSD-3 + Apache-2.0 | 17.2 kB | **Watch**—arrives via Leonardo anyway |
| 1. Color math | `@csstools/color-helpers` | 6.1.1 | 2026-08-15 | MIT-0 | 7.5 kB | **Watch**—primitives only |
| 1. Color math | `@colordx/core` | 6.5.0 | 2026-09-15 | MIT | 8.6 kB | **Avoid for now**—six months old |
| 2. Scale generation | `@adobe/leonardo-contrast-colors` | 1.1.0 | 2026-02-18 | Apache-2.0 | 35.1 kB | **Watch**—read the caveats |
| 2. Scale generation | `@material/material-color-utilities` | 0.4.0 | 2026-01-21 | Apache-2.0 | 25.9 kB | **Avoid**—broken ESM, wrong model |
| 2. Scale generation | `@radix-ui/colors` | 3.0.0 | 2023-10-02 | MIT | data only | **Adopt as fixtures**, not as a generator |
| 2. Scale generation | `@k-vyn/coloralgorithm` | 2.0.0 | 2025-12-29 | ISC / Apache-2.0 | n/a | **Avoid**—license mismatch, no contrast targeting |
| 2. Scale generation | `radix-theme-generator` | 0.1.1 | 2024-10-18 | MIT | n/a | **Avoid**—abandoned at birth |
| 3. Contrast | `culori`'s `wcagContrast` | 4.0.2 | 2025-06-27 | MIT | included | **Adopt** |
| 3. Contrast | `chroma-js`'s `contrastAPCA` | 3.2.0 | 2025-11-28 | BSD-3 | included | **Adopt** for the advisory APCA figure |
| 3. Contrast | `apca-w3` | 0.1.9 | 2022-07-04 | "Limited W3 License" | 1.4 kB | **Avoid—license trap** |
| 3. Contrast | `apcach` | 0.6.4 | 2023-11-13 | MIT | 18.6 kB | **Avoid**—dead, double-bundles culori |
| 3. Contrast | `wcag-contrast` | 3.0.0 | 2019-11-05 | BSD-2 | 0.4 kB | **Avoid**—culori already covers it |
| 4. DTCG | official `format.json` + Ajv standalone | 2025.10 | 2025-10-28 | W3C BSD-3 | 13.0 kB | **Adopt**—only validator scoring 37/37 |
| 4. DTCG | `@terrazzo/parser` | 2.7.1 | 2026-08-11 | MIT | 54.9 kB | **Adopt** for reading—browser-safe |
| 4. DTCG | `@terrazzo/token-tools` | 2.7.1 | 2026-08-11 | MIT | 25.8 kB | **Adopt** for writing—`parseColor()` |
| 4. DTCG | `style-dictionary` | 5.5.3 | 2026-09-06 | Apache-2.0 | 645 kB | **Avoid at runtime**—build step only |
| 4. DTCG | `@vertekum/schema-dtcg` | 0.4.0 | 2026-09-11 | MIT / Apache-2.0 conflict |, | **Avoid**, stub resolver schema |
| 4. DTCG | `@designesy/tokens` | 0.2.2 | 2026-08-16 | MIT | 5.2 kB | **Avoid**—flags conformant files |
| 4. DTCG | `cobalt-ui` | 1.x | 2024-11-24 | MIT |, | **Dead**, became Terrazzo |
| 5. Extraction | `colorthief` | 3.5.0 | 2026-08-02 | MIT | 6.5 kB | **Adopt**—MMCQ in OKLCH |
| 5. Extraction | `node-vibrant` | 4.0.4 | 2026-01-27 | MIT (asserted) | 5.3 kB | **Adopt** as a second opinion |
| 5. Extraction | `extract-colors` | 4.2.1 | 2025-08-04 | MIT | 2.3 kB | **Avoid**—dormant, 5.x abandoned |
| 5. Extraction | `rothko` | 0.2.0 | 2026-04-05 | **no LICENSE file** | 7.1 kB | **Avoid** |
| 6. Fonts | `@capsizecss/metrics` | 4.3.0 | 2026-09-15 | MIT | 224 B/family | **Adopt**—only source with x-height |
| 6. Fonts | `fonts.google.com/metadata/fonts` |, | live | unstated | 18 kB projected | **Adopt as a build-time snapshot**, CORS-blocked at runtime |
| 6. Fonts | `google/fonts` `tags/all/families.csv` |, | live | **unstated** | ~30 kB collapsed | **Adopt**, scored style tags, open CORS |
| 6. Fonts | Google Fonts Developer API | v1 | live |—|, | **Avoid, requires an API key (403)** |
| 6. Fonts | `google-font-metadata` | 6.0.8 | 2026-01-15 | MIT | 55 MB install | **Avoid the package**, vendor one file |
| 7. Plumbing | `idb` | 8.0.3 | 2025-05-07 | ISC | **1.5 kB** | **Adopt** |
| 7. Plumbing | `dexie` | 4.4.6 | 2026-09-10 | Apache-2.0 | 32.8 kB | **Avoid**—no tree-shaking, unneeded |
| 7. Plumbing | `fake-indexeddb` | 6.2.5 | 2025-11-07 | Apache-2.0 | test only | **Adopt**—no platform alternative |
| 7. Plumbing | `fflate` | 0.8.3 | 2026-05-16 | MIT | **4.6 kB** | **Adopt**—`zipSync` only |
| 7. Plumbing | `jszip` | 3.10.2 | 2026-09-08 | MIT or GPL-3.0 | 30.3 kB | **Avoid**—zero tree-shaking |
| 7. Plumbing | `pica` | 10.0.3 | 2026-08-15 | MIT | 16.6 kB | **Watch**—healthy but unnecessary |
| 7. Plumbing | `browser-image-compression` | 2.0.2 | 2023-03-06 | MIT | 21.0 kB | **Avoid—loads jsDelivr at runtime** |
| 7. Plumbing | `createImageBitmap` (platform) |—|—|, | **0** | **Adopt**, no dependency needed |
| 8. Testing | `vitest` + `@vitest/browser` | 5.0.1 | 2026-09-15 | MIT | dev only | **Adopt**—browser mode is stable |
| 8. Testing | `axe-core` | 4.13.0 | 2026-08-05 | MPL-2.0 | dev only | **Adopt** as a devDependency |
| 8. Testing | `vitest-axe` | 0.1.0 | **2022-10-21** | MIT |, | **Avoid, abandoned trap** |
| 8. Testing | `jest-axe` | 11.0.0 | 2026-07-26 | MIT | dev only | **Fallback** if stuck on jsdom |

### The Five Loudest Warnings

1. **`apca-w3` is not permissively licensed**, patents pending, field-of-use restrictions, an AGPL fallback, and **Leonardo ships it in your bundle** even when you only use `formula: 'wcag2'`.
2. **`vitest-axe`'s `latest` tag points at a 2022 release.** A million downloads a week are installing a four-year-old package.
3. **`browser-image-compression` calls `importScripts()` against jsDelivr at runtime by default.** That breaks offline use, breaks CSP, and is a standing supply-chain hole.
4. **`@material/material-color-utilities@0.4.0` does not import under standards-compliant Node ESM.** Reproduced; open eight months.
5. **The Google Fonts metadata you want has no stated licence** and the endpoint that carries the most of it is undocumented and CORS-blocked.

## 1. OKLCH Color Math

### The Shortlist

| | `culori` 4.0.2 | `colorjs.io` 0.7.1 | `chroma-js` 3.2.0 |
|---|---|---|---|
| Repo | [Evercoder/culori](https://github.com/Evercoder/culori) | [color-js/color.js](https://github.com/color-js/color.js) | [gka/chroma.js](https://github.com/gka/chroma.js) |
| License | MIT | MIT | BSD-3-Clause AND Apache-2.0 |
| Last publish | 2025-06-27 | 2026-07-24 | 2025-11-28 |
| Last commit | 2026-07-02 | 2026-09-14 | 2026-09-14 |
| Runtime deps | none | none | none |
| Minimal OKLCH kit, gzip | **1.6 kB** | 19.0 kB | 17.2 kB |
| Realistic Cambium kit, gzip | **8.0 kB** | 19.3 kB | 17.2 kB |
| Everything, gzip | 23.4 kB | 33.7 kB | 17.2 kB |

Version and publish dates from the registry: [culori](https://registry.npmjs.org/culori), [colorjs.io](https://registry.npmjs.org/colorjs.io), [chroma-js](https://registry.npmjs.org/chroma-js).

### culori—Adopt

culori is the answer, and the margin is not close.

The decisive detail is `toGamut`. culori's [`src/clamp.js`](https://github.com/Evercoder/culori/blob/main/src/clamp.js) implements the gamut mapping algorithm from [CSS Color Level 4](https://drafts.csswg.org/css-color/#css-gamut-mapping): binary search on chroma in OKLCH, with the "roughly in gamut" test against a clipped candidate at a 0.02 JND in ΔEOK. Its own source comment says so and names the spec section. It takes a destination gamut as an argument, so `toGamut('rgb')` and `toGamut('p3')` both work:

```
oklch(0.7 0.35 150)  ->  sRGB: oklch(0.709 0.210 147.1)
                     ->  P3:   oklch(0.708 0.288 147.9)
```

That single function covers the gamut-mapping requirement for both sRGB and P3, in the space Cambium already works in. `clampChroma` is the cheaper, blunter variant that holds L and H and bisects chroma alone.

Parsing is fine for the shapes that matter: `oklch()`, `lab()`, `color(display-p3 …)` all round-trip. `color-mix()` returns `undefined`; Cambium does not need it.

`wcagContrast` is present and correct (black on white returns exactly 21) and accepts culori color objects directly, so contrast can be measured without a detour through hex.

Tree-shaking is real, not aspirational. The `culori/fn` entry plus explicit `useMode()` registration is what buys the 1.6 kB floor; the barrel `culori` import costs 23.4 kB. The ergonomic price is that you register the modes you use:

```js
import { useMode, modeOklch, modeP3, modeRgb, converter, toGamut, wcagContrast } from 'culori/fn';
useMode(modeOklch); useMode(modeP3); useMode(modeRgb);
```

At 8.0 kB gzip for the full working set (converter, formatter, parser, contrast, gamut mapping, four modes), this is the cheapest correct option available.

**Maintenance, honestly.** culori is a one-maintainer project on a slow cadence and you should plan around that. Version 4.0.2 shipped [2025-06-27](https://registry.npmjs.org/culori), fifteen months ago. Ten PRs are open, the oldest from [February 2024](https://github.com/Evercoder/culori/pulls). Merges happen roughly twice a year. Three open items touch Cambium's path directly:

- [#276](https://github.com/Evercoder/culori/issues/276)—uppercase function names and angle units throw, though CSS allows them. Relevant if users paste `OKLCH(...)`.
- [#272](https://github.com/Evercoder/culori/pull/272)—`parse` throws instead of returning `undefined` on invalid input. Relevant because Cambium accepts model output and user edits.
- [#270](https://github.com/Evercoder/culori/pull/270)—`clampChroma` desaturates colors that were already in gamut.

None are fatal and all are wrappable. Pin the version, wrap `parse` in a try/catch, and normalize case before parsing. The library is correct and unusually well-tested; it is just quiet.

### colorjs.io—Avoid

The reputation for heaviness is deserved, and the measured reason is more damning than the raw number.

The published tarball unpacks to [15.8 MB](https://registry.npmjs.org/colorjs.io). That alone is not disqualifying, since most of it is types and sourcemaps. What matters is that the `colorjs.io/fn` entry exists specifically to enable tree-shaking, and it barely does:

| Entry | Gzip |
|---|---|
| `colorjs.io/fn`, OKLCH + sRGB + parse + serialize | 19.0 kB |
| `colorjs.io/fn`, plus contrast, gamut mapping, P3, OKLab | 19.3 kB |
| Default `Color` class | 33.7 kB |

Adding four more capabilities cost 337 bytes. The floor is the `ColorSpace` registry, and you pay it whatever you import. culori's equivalent kit is 8.0 kB—colorjs.io is 2.4× the size for the same job.

It is the best-maintained of the three by a distance: last commit [2026-09-14](https://github.com/color-js/color.js/commits/main), maintained by editors of the CSS Color specifications, which is exactly why its conversions are trustworthy. It is also still 0.x after six years, with the API caveats that implies.

Use it as a correctness oracle in tests if you want a second opinion on culori's math. Do not ship it.

### chroma-js—Watch, and You Will Get It Anyway

chroma-js has had a real revival: commits on [2026-09-14](https://github.com/gka/chroma.js/commits/main) fixing OKLCH interpolation endpoints, HSL alpha, and HSV converter naming. That is a healthier repo than it was two years ago.

It is not the right foundation for Cambium—no CSS Color 4 gamut mapping, and its scale API is positional rather than contrast-targeted (see area 2)—but it becomes relevant for two other reasons. It carries a genuinely useful APCA implementation (area 3), and it arrives transitively if you adopt Leonardo.

**One packaging bug worth knowing.** The `exports` map declares a `./light` subpath pointing at `./index-light.js`, and that file is not in the published tarball. `import chroma from 'chroma-js/light'` fails to resolve against 3.2.0. Verified by listing the registry tarball contents. Use the main entry.

License is BSD-3-Clause for the library, with Apache-2.0 covering the bundled ColorBrewer data, per the [LICENSE file](https://github.com/gka/chroma.js/blob/main/LICENSE). Both permissive. GitHub's API reports `NOASSERTION` only because clause 3 is reworded from stock BSD-3.

### Is There a Lighter Modern Option?

Two candidates surfaced. Neither displaces culori.

**`@csstools/color-helpers` 6.1.1** ([registry](https://registry.npmjs.org/@csstools/color-helpers), [source](https://github.com/csstools/postcss-plugins/tree/main/packages/color-helpers)) is the color math underneath the CSS Working Group's own PostCSS tooling. MIT-0, zero dependencies, 7.5 kB gzip for the entire export surface, 235M downloads a month. It exports `mapGamut`, `mapGamutRayTrace`, `contrast_ratio_wcag_2_1`, `inGamut`, and the full matrix of `*_to_*` conversions.

It is genuinely excellent and genuinely lower-level: raw functions over `[number, number, number]` arrays with no color object, no parser, no formatter. Choosing it means writing the parse and serialize layers yourself. Worth keeping in mind as a fallback if culori ever stalls, and worth reading for its ray-trace gamut mapping, which is faster than binary search.

**`@colordx/core` 6.5.0** ([registry](https://registry.npmjs.org/@colordx/core), [repo](https://github.com/dkryaklin/colordx)) is 8.6 kB gzip for everything, MIT, plugin-architected, with `oklchTo*` fast paths and an `a11y` plugin offering `fixContrast`, `apcaContrast`, and `minReadable`. On paper it is the most Cambium-shaped library in this list.

It is also six months old. The repository was [created 2026-03-22](https://github.com/dkryaklin/colordx), has one maintainer, three forks, and has shipped 62 versions, six of them in the past two weeks. Its reported download count is wildly out of proportion to a project with 126 stars, which is its own signal. Revisit in a year. Do not build a correctness-critical color pipeline on it today.

### What culori Replaces in Cambium

| Planned by hand | culori gives you |
|---|---|
| OKLCH ↔ sRGB ↔ P3 conversion | `converter('oklch')`, `converter('p3')` |
| Gamut mapping to sRGB and P3 | `toGamut(dest, 'oklch')`, the CSS Color 4 algorithm |
| Parsing seed colors and user edits | `parse` |
| Serializing to `oklch()` for DTCG and CSS | `formatCss`, `formatHex` |
| WCAG contrast measurement | `wcagContrast` |
| Chroma reduction holding L and H | `clampChroma` |

**Remaining bespoke work: none in this area.** Color math is a solved dependency. The wrapper is a thin module that registers modes, normalizes case before parsing, and catches parse failures.

## 2. Contrast-Targeted Scale Generation

This is the area the Cambium spec itself names as "the principal technical risk in the project," and the research changes the shape of that risk rather than removing it.

### The Finding That Reframes the Problem

Radix publishes exactly **one** numeric contrast guarantee across all twelve steps. From the current source of [understanding-the-scale.mdx](https://github.com/radix-ui/website/blob/main/data/colors/docs/palette-composition/understanding-the-scale.mdx):

> Steps `11` and `12` — which are designed for text — are guaranteed to Lc 60 and Lc 90 APCA contrast ratio on top of a step `2` background from the same scale.

Everything else is qualitative. [Steps 1–2](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) are "app background" and "subtle background," 6–8 are borders "subtle" to "stronger," step 9 is described as "the highest chroma of all steps… the purest step." No numbers.

Two consequences follow, and both are load-bearing.

**First, the documented target is APCA, not WCAG.** Cambium plans WCAG 2.2 AA repair with APCA as an advisory figure (spec stories 37 and 38). That is the right call, but it means Cambium is not implementing Radix's stated guarantee—it is implementing a different one. Those criteria disagree, most visibly for mid-tone colors and for light-on-dark pairs where APCA's polarity handling diverges from WCAG's symmetric ratio. Say so in the product rather than implying Radix compliance.

**Second, Radix changed this guarantee and did not fix the scales.** Issue [radix-ui/colors#42](https://github.com/radix-ui/colors/issues/42), open since 2024-02-28, reports that Yellow, Amber, and Orange fail the guarantee the docs stated at the time—"Steps 11 and 12 are guaranteed to pass 4.5:1 contrast ratio on top of a step 3 background." The docs now say Lc 60/90 against step 2 instead. The issue has one comment, a `cc` to a maintainer, and no reply in nineteen months.

So the hand-tuned reference scales do not hold the invariant Cambium wants to hold automatically. This is good news for the product thesis and bad news for using Radix as an oracle: **the fixtures cannot be a correctness target, only a taste target.**

### Is There a Published Radix Scale Generator?

No.

The [radix-ui/colors repository](https://github.com/radix-ui/colors) contains, in full: the hand-tuned scale files under `src/`, a `scripts/build-css-modules.js` build helper, and config. There is no generation code. `@radix-ui/colors` 3.0.0 was published [2023-10-02](https://registry.npmjs.org/@radix-ui/colors) and has not shipped since—it is a static data package and nothing more.

`@radix-ui/themes` does not contain one either. The only generation helper in that repo is [`get-matching-gray-color.ts`](https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/helpers/get-matching-gray-color.ts), which picks a gray to pair with an accent. Every scale ships as static CSS under `src/styles/tokens/colors/`.

The custom scale generator at [radix-ui.com/colors/custom](https://www.radix-ui.com/colors/custom) is an unpublished client-side tool on their marketing site. Its algorithm has never been released.

Community ports are not a path either. `radix-theme-generator` 0.1.1 shipped [two versions on a single day in October 2024](https://registry.npmjs.org/radix-theme-generator) and has had no commits since; the repo has 9 stars. It is a reasonable read for reverse-engineering ideas, not a dependency.

### @adobe/leonardo-contrast-colors—Watch, With Real Caveats

Leonardo does generate scales by target contrast ratio, which is exactly the primitive Cambium needs, and it does it well.

**Version 1.1.0, published [2026-02-18](https://registry.npmjs.org/@adobe/leonardo-contrast-colors), Apache-2.0, 35.1 kB gzip.** Pure ESM with no Node built-ins; it bundles for the browser cleanly. TypeScript types ship in the package as a hand-written `index.d.ts`.

The API is the right shape. You give it key colors, an interpolation color space, and a list of target ratios; it returns colors that hit those ratios against a stated background:

```js
new Color({ name: 'brand', colorKeys: ['#3b82f6'], colorSpace: 'OKLCH',
            ratios: [1.05, 1.1, 1.2, 1.35, 1.5, 1.8, 2.3, 3.2, 3.7, 4.3, 5.5, 13] });
```

Run against a white background with `colorSpace: 'OKLCH'`, that produces a twelve-step ramp that hits every requested ratio and holds hue tightly:

| Step | Hex | Target cr | OKLCH L | C | ΔH from seed |
|---|---|---|---|---|---|
| 1 | `#f7faff` | 1.05 | 0.984 | 0.007 | +0.9° |
| 5 | `#b9d4ff` | 1.5 | 0.864 | 0.067 | −0.2° |
| 9 | `#3b82f5` | 3.7 | 0.622 | 0.187 | −0.1° |
| 11 | `#1b63d5` | 5.5 | 0.526 | 0.189 | +0.1° |
| 12 | `#002091` | 13 | 0.329 | 0.184 | +4.0° |

Two things stand out. Hue drift stays under about 1° for steps 1–11, which is better than the seed-preservation requirement implies. And step 9 lands on `#3b82f5` against a seed of `#3b82f6`—choosing the ratio that matches the seed's own contrast reproduces the brand color essentially exactly, which is precisely the "step 9 = the pure brand color" constraint.

**Now the caveats, which are substantial.**

*The OKLCH output formatter is broken.* `output: 'OKLCH'` produces garbage:

```
convertColorValue('#3b82f6', 'OKLCH')  ->  "oklch(1, 0, 25981%)"
convertColorValue('#3b82f6', 'OKLAB')  ->  "oklab(1, 0, -19%)"
convertColorValue('#3b82f6', 'LCH')    ->  "lch(56%, 67, 285)"     // fine
```

Lightness and chroma are rounded to integers, which collapses OKLCH's 0–1 and 0–0.4 ranges to 0 or 1, and hue is multiplied by 100 and suffixed with a stray `%`. LCH, LAB, HSL, HEX, and RGB are all fine, because their channel ranges survive integer rounding. Issue [#255](https://github.com/adobe/leonardo/issues/255), "Allow OKlab / OKlch as output format," has been open since 2025-08-19: the type union was extended but the formatter never was. **Mitigation: use `output: 'HEX'` and convert with culori.** Interpolation in OKLCH still works correctly; only serialization is broken.

*It ships APCA code under a non-permissive license.* Leonardo depends on `apca-w3` ([package.json](https://registry.npmjs.org/@adobe/leonardo-contrast-colors)), whose license is discussed in area 3 and is not permissive. I checked whether it survives bundling: the minified browser build contains `Myndex` four times, `APCAcontrast` twice, and `sRGBtoY` three times. **It is not tree-shaken out even when you only use `formula: 'wcag2'`.** Adopting Leonardo means shipping that code in a static bundle. This is the single strongest argument against it.

*Every construction logs a deprecation warning.* `new Color({ colorSpace: 'OKLCH' })` still prints ``Leonardo: `colorspace` is deprecated. Use `colorSpace` instead.``: the warning fires from Leonardo's own internals ([`lib/color.js`](https://github.com/adobe/leonardo/blob/main/packages/contrast-colors/lib/color.js)), not from your call. PR [#281](https://github.com/adobe/leonardo/pull/281) fixes it and has been open since 2026-03-26, with a second user confirming the problem in May.

*Maintenance is community-carried.* The repo is alive, last commit [2026-07-08](https://github.com/adobe/leonardo/commits/main), community PRs merged in May and July 2026, but Adobe's own presence is thin and most open issues are Dependabot noise. The project survives on contributor goodwill.

*Structural mismatch.* Leonardo models contrast against a **single** background color. Radix step roles are relative to steps 1–2 of the same scale, which Leonardo can express by setting the background to the step-1 color, and dark mode works the same way with a dark background and `lightness: 8`. But steps 6–8 (borders) should hold contrast against the 1–5 range rather than against step 1 alone, and Leonardo cannot express that. You approximate.

### @material/material-color-utilities—Avoid

Google's HCT library. **Version 0.4.0, published [2026-01-21](https://registry.npmjs.org/@material/material-color-utilities), Apache-2.0.** The repo was not deprecated or moved; [material-foundation/material-color-utilities](https://github.com/material-foundation/material-color-utilities) is active, last pushed 2026-08-21. But the activity is Google-internal: the last three commits are titled "Internal change," "internal change," and "Internal change."

Three reasons to pass.

**The published ESM is broken.** Issue [#195](https://github.com/material-foundation/material-color-utilities/issues/195), "ESM barrel export broken in 0.4.0—missing .js extensions in internal imports," is open with 8 comments. I reproduced it:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dynamiccolor/dynamic_color'
```

The barrel uses `./dynamiccolor/dynamic_color.js`, but files under `scheme/` import `'../dynamiccolor/dynamic_scheme'`, `'../palettes/tonal_palette'`, and `'./color_spec'` without extensions. esbuild tolerates this via Node-style resolution fallback; standards-compliant Node ESM does not. **Your Vitest suite will fail to import it.** Eight months open.

**It does not tree-shake.** Full import is 25.9 kB gzip; importing only `Hct`, `TonalPalette`, and `Contrast` is 20.0 kB. You pay for the whole library to use three classes.

**The model is wrong for the job.** `TonalPalette` emits fixed tones (0, 10, 20 … 100) and guarantees nothing about contrast between them: the guarantee lives in Material's `DynamicScheme`/`DynamicColor` layer, which encodes Material's design language, not Radix's. There is a useful primitive in [`Contrast`](https://github.com/material-foundation/material-color-utilities/blob/main/typescript/contrast/contrast.ts): `Contrast.lighter(tone, ratio)`, documented as "Returns a tone >= tone parameter that ensures ratio parameter. Returns -1 if ratio cannot be achieved." That is contrast-targeted tone search, but only in the tone dimension, on a WCAG-style ratio computed from XYZ Y, and reaching it costs 20 kB and a broken import.

Producing Radix-like twelve-step semantics from it means discarding Material's scheme layer entirely, at which point you are writing the generator anyway.

### The Others

**`@k-vyn/coloralgorithm` 2.0.0**: published [2025-12-29](https://registry.npmjs.org/@k-vyn/coloralgorithm), the ColorBox algorithm. Two problems. It has no contrast targeting: it produces scales from Bézier-eased hue, saturation, and lightness curves, which is positional generation with a nicer curve. And the license is inconsistent: npm metadata says `ISC`, the [repository](https://github.com/k-vyn/coloralgorithm) reports Apache-2.0. Both are permissive, but a package that cannot state its own license consistently is one to avoid. The repo is also a fork with three releases in six years.

**`chroma-js` `scale`/`bezier`**: positional, not contrast-targeted. Asking for twelve steps between white, the seed, and black in OKLCH gives step 11 a contrast of 15.2:1 against step 2, three times the 4.5:1 target, because nothing was targeting anything. `correctLightness()` evens out perceived lightness distribution; it does not hit ratios. Useful for smoothing a ramp you already positioned. Not a generator.

**`apcach`**—generates colors by APCA target, which sounds ideal. See area 3; it is dead and it double-bundles culori.

**Tailwind CSS 4.3.3**: the [`./colors` export](https://registry.npmjs.org/tailwindcss) is a static palette object. There is no generator API. Tailwind v4 ships its palette in OKLCH, which makes it a useful reference set, nothing more.

**`open-color` 1.9.1**—static JSON, last published [2021-08-17](https://registry.npmjs.org/open-color). Fixtures only.

**Huetone**—[ardov/huetone](https://github.com/ardov/huetone) is MIT and an excellent read on the problem, but it is an application, not a library. There is no `huetone` package on npm, and the repo was last pushed 2023-11-19. Reference material.

### Ranked Recommendation

**1. culori plus a bespoke generator.** Write the L and C curves yourself; use culori for conversion, gamut mapping, and contrast; use Leonardo's ratio-solving idea without Leonardo.

This is the recommendation, and the reason is that the bespoke part is much smaller than the spec fears. A working prototype—twelve-step ramp from an arbitrary seed, Radix step semantics, WCAG repair that moves lightness in OKLCH while holding hue and chroma—is **27 lines of code** on top of culori. Across four very different seeds it produced:

| Seed | Hue | Step 11 cr vs step 2 | Step 12 cr vs step 2 | Repairs needed |
|---|---|---|---|---|
| `#3b82f6` | 259.8° | 5.73 | 13.75 | none |
| `#eab308` | 86.0° | 5.64 | 13.68 | none |
| `#e11d48` | 17.6° | 6.13 | 14.01 | none |
| `#10b981` | 162.5° | 5.17 | 13.27 | none |

The structural insight that falls out: **because lightness is fixed per step, contrast against step 2 is very nearly hue-independent.** Step 11 landed between 5.17 and 6.13 across the whole hue circle. The contrast repair loop is a safety net that rarely fires, not the core of the algorithm. The real work, and the real risk, is choosing the L and C curves, which is a taste problem, not a math problem.

**2. Leonardo, if you accept the APCA license in your bundle.** It solves ratio-targeting properly and holds hue better than expected. Use `output: 'HEX'` and convert with culori. Reassess if the `apca-w3` dependency is ever dropped.

**3. `@csstools/color-helpers`** as a lower-level substrate if culori stalls.

**4. Everything else.** No.

### What This Replaces, and What Genuinely Remains

| Planned by hand | Replaced by | Remains |
|---|---|---|
| OKLCH math, gamut mapping, contrast | culori | Nothing |
| Ratio-targeted step solving | Leonardo, or ~15 lines of bisection | Trivial either way |
| WCAG repair holding hue and chroma | Nothing | ~15 lines; verified to land on 4.500 exactly |
| **L and C curves per step, per mode, per preset** | **Nothing** | **All of it** |
| Radix step-role target table | Nothing—Radix publishes only one | All of it |
| Dark ramp derivation against the same roles | Nothing | All of it |
| Neutral ramp from a temperature hint | Nothing | All of it |
| Accent derivation by hue rotation | Nothing | All of it |

The honest summary: **adopting the best available library removes roughly the bottom third of the problem, the color math, and none of the top two-thirds.** No library encodes Radix's step semantics, because Radix has never published them numerically. Cambium has to define that target table itself, and then defend it on taste. That is the actual project, and it was always going to be.

The mitigating finding is that the deterministic scaffolding around it is small, fast, and testable, and that the twelve-step-plus-repair machinery is a day of work rather than the multi-week risk the spec anticipates. Budget the time for tuning curves and building a visual regression harness against the Radix fixtures, not for building infrastructure.

## 3. Contrast Measurement

### WCAG 2.2—Use culori, Nothing Else

WCAG 2.2 did not change the contrast formula. [SC 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum) still reads: "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1." The 2.2 additions, Focus Appearance, Target Size, Focus Not Obscured, do not touch the ratio. Anything that computed a correct WCAG 2.0 ratio computes a correct 2.2 ratio.

culori's `wcagContrast` is correct, already in the bundle, and accepts color objects directly so you never round-trip through hex. Black on white returns exactly 21.

`wcag-contrast` 3.0.0 is tiny (422 bytes gzip) and BSD-2, but it was last published [2019-11-05](https://registry.npmjs.org/wcag-contrast), takes only hex and RGB arrays, and duplicates something culori already does. **Avoid** it as redundant; the library itself is sound.

### APCA—The License Is the Whole Story

**`apca-w3` 0.1.9 is a trap. Do not ship it.**

Its npm license field reads `Limited W3 License`, which is not an SPDX identifier and not a permissive license. The [LICENSE.md in the published tarball](https://github.com/Myndex/apca-w3/blob/master/LICENSE.md) is worth reading in full before making any decision; the operative clauses:

> Code and documentation in this repositiory is copyright © 2019-2022 by Andrew Somers and/or Myndex™. All Rights Reserved. **Patent(s) pending.**

> Files in this repository are licensed to the W3/AGWG under their cooperative agreement for use with WCAG accessibility guidelines for **web-delivered and web-based content only, and not for any other use.**

> Any files, or use cases of files, not under the W3 cooperative agreement are licensed under the **AGPU v3 License** [sic—AGPL].

> Prohibited uses include medical, clinical evaluation, human safety related, aerospace, transportation, military applications…

> Developers incorporating this code into their applications… **have a duty to ensure that the most recent version of this code is used in their current or any future release.**

Patent claims, field-of-use restrictions, an AGPL fallback, trademark conditions on the name, and an affirmative obligation to keep current. That fails Cambium's permissive-license constraint on several independent grounds.

It is also frozen. Version 0.1.9 published [2022-07-04](https://registry.npmjs.org/apca-w3); the last substantive commit to [Myndex/apca-w3](https://github.com/Myndex/apca-w3) was 2023-09-14, and the only 2026 commit adds a code of conduct. Open issues date to 2022 and 2023 with no maintainer resolution. No TypeScript types ship; `@types/apca-w3` 0.1.3 exists separately and is itself three years old.

`bridge-pca` 0.1.6 is the same author under a `W3 License` field and the same problems.

### The Clean Alternative: chroma-js

**This is the most useful finding in this section.** chroma-js 3.2.0 ships `chroma.contrastAPCA()` as an independent implementation of the published APCA-1.0.98G formula, under chroma-js's BSD-3-Clause license. Its [source](https://github.com/gka/chroma.js/blob/main/src/utils/contrastAPCA.js) carries a `@license` header crediting the Myndex specification document rather than copying Myndex's code, and implements the constants directly.

I checked whether it is actually correct by running it head-to-head with `apca-w3` across both polarities:

| Pair | chroma-js | apca-w3 | Δ |
|---|---|---|---|
| `#000000` on `#ffffff` | 106.0407 | 106.0407 | 0.000000 |
| `#ffffff` on `#000000` | −107.8847 | −107.8847 | 0.000000 |
| `#3b82f6` on `#ffffff` | 63.8942 | 63.8942 | 0.000000 |
| `#888888` on `#ffffff` | 63.0565 | 63.0565 | 0.000000 |
| `#e11d48` on `#1a1a1a` | −29.8260 | −29.8260 | 0.000000 |
| `#6b7280` on `#f9fafb` | 70.4744 | 70.4744 | 0.000000 |

Identical to the last decimal place, including sign. **Adopt `chroma.contrastAPCA` for Cambium's advisory APCA figure.**

Two honest caveats. The copyright problem is solved by reimplementation; the **trademark and patent overhang is not.** Myndex's license asserts that the name "APCA" may be used only for implementations that are "correctly implemented, maintained, and up to date," and asserts pending patents. chroma-js's own header calls its implementation "still beta." Present the number as an advisory figure and consider labelling it "APCA-1.0.98G (independent implementation)" rather than claiming conformance.

The cost is 17.2 kB gzip for chroma-js, which is a lot for one function. If you adopt Leonardo, chroma-js is already there. If you do not, the formula is roughly 30 lines and the constants are published in the specification—porting it into Cambium under your own license is a legitimate option and avoids the dependency entirely.

### APCA Is Not in WCAG 3

Worth settling, because it determines how confidently Cambium can frame the advisory number. In the [WCAG 3.0 Working Draft of 10 September 2026](https://www.w3.org/TR/wcag-3.0/):

- The string "APCA" appears **zero times**.
- An editor's note states plainly: "**The contrast algorithm used in WCAG 3 is yet to be determined.**"

Spec story 38—"I want APCA shown alongside as an advisory figure, so that I can see the perceptually better number without claiming a standard that is not normative"—is exactly right, and now has a citation.

### apcach—Avoid

`apcach` generates colors by APCA target, which is the right idea. It is dead.

**Version 0.6.4, published [2023-11-13](https://registry.npmjs.org/apcach)**—nearly three years ago. The [repository](https://github.com/antiflasher/apcach) was last pushed 2025-02-04. Issue [#21](https://github.com/antiflasher/apcach/issues/21), "publish a new release targeting culori 4.x," was filed 2026-04-10 and has zero comments. Issue [#20](https://github.com/antiflasher/apcach/issues/20) asks for TypeScript definitions; there are none, and no `@types/apcach` exists.

The concrete damage: it depends on `culori@^3.2.0`, so npm installs culori 3.3.0 nested under `apcach` alongside your culori 4.0.2. **You bundle culori twice.** That is most of why it measures 18.6 kB gzip, more than twice Cambium's entire culori kit, and it drags `apca-w3` in with it, reintroducing the license problem.

3,340 downloads a month. Avoid.

### Recommendation

| Need | Use | Cost |
|---|---|---|
| WCAG 2.2 AA ratios | `culori`'s `wcagContrast` | already in bundle |
| Advisory APCA figure | `chroma.contrastAPCA`, or port ~30 lines | 17.2 kB, or 0 |
| Generating colors by APCA target | your own bisection | ~15 lines |

**Remaining bespoke work: minimal.** The lightness-bisection repair loop is the same fifteen lines whether the objective function is WCAG or APCA—swap `wcagContrast` for `contrastAPCA` and change the target. That directly serves spec story 42 (repair in OKLCH holding hue and chroma) and story 43 (never move a pinned token, adjust the other side).

## 4. DTCG

Three assumptions in the brief turned out to be wrong, and each one changes an answer.

### First: 2025.10 Is Not a Draft

It is the DTCG's first **stable release**: a set of Final Community Group Reports dated **28 October 2025**. The [Format Module](https://www.designtokens.org/TR/2025.10/format/) carries the subtitle "Final Community Group Report 28 October 2025" and the status text "This specification is considered stable. Further updates will be provided in superseding specifications."

**Cite `https://www.designtokens.org/TR/2025.10/…` and nothing else.** There is a URL trap: `design-tokens.github.io/community-group/format/` 301-redirects to the Preview draft, which states "Do not attempt to implement this version of the specification"—and whose `<title>` still reads "2025.10." Verified:

```
$ curl -sI https://design-tokens.github.io/community-group/format/
HTTP/2 301
location: http://tr.designtokens.org/format/
```

### Second: @terrazzo/parser Does Run in a Browser

One Node reference in the entire dependency graph, dynamic and guarded.

### Third: There Is an Official Normative JSON Schema, Published by the CG Itself

Not third-party, and it is the only validator that is actually correct.

### The Measurement That Should Drive the Decision

The official conformance suite (`test-suite/tests/2025.10/format/`) was run against each validator: all 37 color cases, 17 positive and 20 negative:

| Validator | Score | What it gets wrong |
|---|---|---|
| **Ajv 8.20 + official `format.json`** | **37/37** | nothing |
| `@terrazzo/parser` 2.7.1 + recommended lint | 33/37 | rejects the legal `"none"` keyword; accepts malformed `hex`; accepts `hue == 360` |
| `@styleframe/dtcg` 1.1.0 | 26/37 | **all eleven failures are numeric range checks it does not perform** |

`@styleframe/dtcg` validates *structure* only. It accepts negative chroma, lightness above 100, and 8-digit hex. For a tool whose entire job is generating numerically valid OKLCH, that is disqualifying.

### The Official JSON Schema—Adopt, and Vendor It

- [`https://www.designtokens.org/schemas/2025.10/format.json`](https://www.designtokens.org/schemas/2025.10/format.json)—**56,523 bytes, 5.5 kB gzipped.** Verified live.
- Dialect is **draft-07** (`$schema: http://json-schema.org/draft-07/schema#`), so use Ajv's plain entry point, *not* `ajv/dist/2020`.
- Fully self-contained: no external `$ref`s.
- License: W3C 3-clause BSD for the software and test suite.

**`@dtcg/schemas` is `"private": true` and is not on npm.** The hosted JSON is the only distribution, so vendor it with a refresh script and review the diff.

SchemaStore has two entries (added 2026-08-27) but hosts no copy: both link to designtokens.org, and neither carries a `fileMatch`, so editors will not auto-apply them.

**Ajv specifics.** `ajv-formats` is required: the schema uses `uri-reference` and `json-pointer-uri-fragment`, and without it strict mode throws `unknown format`. Current versions are `ajv@8.20.0` and `ajv-formats@3.0.1`, both MIT.

**The CSP problem, and the fix that is also smaller.** Ajv compiles schemas with `new Function`. [Ajv's own security docs](https://ajv.js.org/security.html#content-security-policy) say the `script-src` directive must include `'unsafe-eval'` unless you precompile. Precompile with `ajv/dist/standalone` at build time:

| Approach | Gzip | CSP |
|---|---|---|
| **standalone precompiled validator** | **13.0 kB** | no `unsafe-eval` needed |
| `ajv` + `ajv-formats` at runtime | 40.9 kB | requires `unsafe-eval` |

Standalone wins on both axes, and Ajv becomes a devDependency.

**One real limitation.** The schema cannot fully model group-level `$type` inheritance: with `$type` on the group, a bare string `$value` like `"#ff0000"` passes. JSON Schema cannot propagate a parent's type. Schema and parser are genuinely complementary: the schema is stricter on values, Terrazzo is stricter on structure and references.

### @terrazzo/parser 2.7.1—Adopt, With One Build-Config Line

**Published [2026-08-11](https://registry.npmjs.org/@terrazzo/parser), MIT, repo [terrazzoapp/terrazzo](https://github.com/terrazzoapp/terrazzo) pushed 2026-09-10, ~331k downloads a month. The entire twelve-package dependency tree is MIT / Apache-2.0 / ISC with zero copyleft.** 54.9 kB gzip.

**Browser answer: yes.** The only Node reference in the whole graph is in `dist/parse/index.js`:

```js
let fs;
async function defaultReq(src, _origin) {
  if (src.protocol === 'file:') {
    if (!fs) fs = await import('node:fs/promises');
    return await fs.readFile(src, 'utf8');
  }
  const res = await fetch(src);   // the browser path
  ...
}
```

A dynamic import behind a `file:` protocol guard, unreachable for in-memory input. **Vite handles it with no configuration**: it warns that `node:fs/promises` was externalized, emits a stub, and builds. A real production build measured 244 kB raw / 65 kB gzip. Raw esbuild or Rollup needs `--external:node:fs/promises`. Alternatively, pass your own `req` function and never reach the branch.

Verified working in a browser bundle with `globalThis.process = undefined`: parse, alias resolution, alias *chains*, `$extensions` passthrough, `$ref` JSON Pointers, modes, and the 2025.10 Resolver.

**It targets 2025.10 strictly.** The 2.0.0 changelog: "Full support for the DTCG v2025.10 spec, including resolvers" and "Breaking change; DTCG 2nd Editors draft format will throw errors by default." The TypeScript type pins it literally as `version: '2025.10'`.

**Aliases are resolved thoroughly.** Every token gets `aliasOf` (final target) and `aliasChain` (full path). Both reference syntaxes work, including §7.3.1 property-level component references: `$ref: '#/base/blue/$value/components/0'` resolves correctly. That is genuine 2025.10 conformance most tools lack, and it matters for Cambium's semantic-aliases-onto-primitives design.

**No `new Function`, no `eval`.** For a static site with a strict CSP, that is worth something.

**Three traps.**

*`parse()` does not validate by default.* With default options it accepted a missing `colorSpace`, a `colorSpace` of `"not-a-space"`, and two components where OKLCH needs three. You must wire lint explicitly:

```ts
defineConfig({ lint: { rules: RECOMMENDED_CONFIG } }, { cwd: new URL('https://x/') })
```

It is easy to ship a broken export without noticing.

*It accepts three colorSpaces the spec does not define.* Terrazzo allows 17; the spec defines 14. The extras are `lab-d65`, `okhsv`, and bare `xyz`. Files using them parse in Terrazzo and fail official schema validation.

*Silent data loss on a spec-mandated form.* A token using the §7.1.2 sibling-`$ref` form is **silently dropped**: no error, no warning, even with full lint:

```json
"primary": { "$ref": "#/colors/blue/$value", "$type": "color" }
```

No matching issue was found in the tracker. Worth filing upstream, and worth a regression test in Cambium if you rely on that form.

### @terrazzo/token-tools—The Sleeper Hit

**2.7.1, 2026-08-11, MIT, ~360k downloads a month, 25.8 kB gzip, 100% browser-clean with no externals needed, full types.**

This is how you *write* DTCG colors. `parseColor()` turns any CSS color string into a spec-shaped 2025.10 `$value`:

```js
parseColor('#4a90d9')                 // {colorSpace:'srgb',  components:[0.290,0.565,0.851], alpha:1}
parseColor('oklch(70% 0.15 250)')     // {colorSpace:'oklch', components:[0.7,0.15,250],      alpha:1}
parseColor('color(display-p3 1 0 0)') // {colorSpace:'display-p3', components:[1,0,0], alpha:1, hex:'#ff0b0c'}
```

It also exports `COLOR_SPACE`, `tokenToColor`, `splitID`, `isValidDTCGType`, and `makeAlias`.

**`@terrazzo/token-types`** is pure types, 25 bytes of runtime and effectively free. If you want nothing else from Terrazzo, take this.

### Writing DTCG Really Is JSON.stringify

**There is no DTCG serializer worth using, and none is needed.** DTCG is plain JSON; the work is getting the `$type` and `$value` shapes right, not serializing. No `serialize`, `stringify`, `toDTCG`, or `emit` export exists in `@terrazzo/parser` or `@terrazzo/token-tools`; `build()` runs plugins that emit CSS and JS and never emits DTCG.

The full round-trip was proven in a browser bundle: write with `parseColor` + `makeAlias` + `JSON.stringify`, read back with `parse` + recommended lint. `$extensions` survived, aliases resolved. About fifteen lines.

The only genuine converter is `convertToDTCG` from `style-dictionary/utils`, and it renames `value` to `$value`. It transitively imports `@zip.js/zip.js` at module top level, so it cannot be tree-shaken: **132 kB gzipped to rename keys.** Read the source and write the forty lines.

### The Two Suspect Packages

**`@vertekum/schema-dtcg`: avoid.** Version 0.4.0, 2026-09-11, repo created 2026-08-17 with one star and 18 versions in 25 days. **Its license is inconsistent: `package.json` says MIT, the GitHub repo says Apache-2.0.** Its `format.json` is byte-identical to the official file, which is just `curl`. But its `resolver.json` is a 1,646-byte hand-written stub against the official 70,725 bytes, declares the wrong dialect, and invents its own `$id`. Its own README concedes the resolver schema is "hand-kept." It will silently under-validate. Vendor the official file instead.

**`@designesy/tokens`: avoid for conformance.** Version 0.2.2, 2026-08-16, MIT, 691 downloads a month, 5.2 kB, browser-safe. The publishing pattern is a flag: nine packages, eight published in a 36-hour window as scoped-and-unscoped near-duplicates, repo with zero stars, forks, and watchers. The code is real and the twenty checks are real functions, but several are not conformance checks. It requires `$description` (the spec does not), requires OKLCH or Display-P3 (the spec permits fourteen spaces), and requires `$schema` (optional). **It will flag spec-conformant files.** It is an opinionated linter wearing a validator's name.

### Other DTCG Tooling

| Package | Verdict | Note |
|---|---|---|
| `style-dictionary` 5.5.3 | build step only | v5 is browser-capable via a memfs export condition, but **645 kB gzipped** and `engines: node >=22`. It *consumes* DTCG; there is no DTCG output format. |
| `@styleframe/dtcg` 1.1.0 | avoid as a validator | 26/37. Its npm "serializer" claim is false—`format()` returns CSS strings. **License unresolved: npm says MIT; there is no LICENSE file in the repo or the tarball.** |
| `@unpunnyfuns/swatchbook-core` | avoid | imports `node:fs`, `node:path`, `node:url` at top level; `engines: node >=24.14`. |
| `@udt/parser-utils`, `@udt/dtcg-utils` | watch | ISC, browser-clean, 0.76 kB, by a DTCG editor. Generic traversal and edition-migration helpers. Neither writes DTCG. |
| **`cobalt-ui`** | **dead—confirmed** | The repo redirects to `terrazzoapp/terrazzo`; it was transferred, not archived. Last publish 2024-11-24. Terrazzo is its successor. |
| `@nclsndr/w3c-design-tokens-parser` | avoid | last publish 2024-10-05. |

### What 2025.10 Says About Color

Color lives in a **separate module**. Format Module §8.1 is one sentence deferring to the [Color Module](https://www.designtokens.org/TR/2025.10/color/).

**§4.1 Format.** `colorSpace` (required) and `components` (required, each element either a number or the `'none'` keyword); `alpha` optional, assumed 1 when omitted; `hex` optional and explicitly a **fallback**, which "MUST be formatted in 6 digit CSS hex color notation format to avoid conflicts with the provided alpha value." Verified against the spec text.

**Hex strings were removed, not deprecated.** The 2022 Second Editors' Draft language permitting a bare hex string `$value` was deleted with no grace period and no migration note. The object form is the only legal form. Terrazzo is lenient here—it accepts `"$value": "#ff0000"` and warns that "string colors will be deprecated in a future version," which is wrong twice. Fine as an import affordance; not conformance.

**Fourteen colorSpace values, and `oklch` is one of them.** Confirmed directly from the schema enum:

```
srgb  srgb-linear  hsl  hwb  lab  lch  oklab  oklch
display-p3  a98-rgb  prophoto-rgb  rec2020  xyz-d65  xyz-d50
```

**§4.2.8 OKLCH is `[L, Chroma, Hue]` where L is 0–1 (not 0–100), chroma has a minimum of 0 and in practice does not exceed 0.5, and hue runs from 0 up to but not including 360.** Hue of exactly 360 is invalid. Cambium's seed already stores OKLCH as a `[number, number, number]` tuple, so the mapping is direct—just confirm L is normalized to 0–1 and hue is wrapped below 360 before serializing.

**Aliases, §7.** The curly-brace syntax always resolves to `$value` and can only target complete tokens. Tools **MUST** also support JSON Pointer notation via `$ref`. Aliases MAY reference other aliases, and tools MUST follow each reference to an explicit value. References MUST NOT be circular, and tools MUST detect and report that. **Property-level references require `$ref` and cannot be expressed in curly braces**—relevant if Cambium ever aliases a single OKLCH component. Token names MUST NOT contain `{`, `}`, `.`, or start with `$`.

**`$extensions`, §5.2.3.** Vendor-specific keys, reverse domain name notation recommended, and, critically for Cambium, "**Tools that process design token files MUST preserve any extension data they do not themselves understand.**" The requirement is *preserve*, never *ignore*. Cambium's provenance and rationale data (spec stories 29, 30, 32) belongs here under something like `com.cambium.provenance`, and any round-trip must not drop foreign keys.

**Also real spec features, not Terrazzo inventions:** `$deprecated` (true, a string, or false) and `$extends` (new in 2025.10, group-level only). `$type` is case-sensitive, inherits from the closest parent group, and "Tools MUST NOT attempt to guess the type… by inspecting the contents of its value."

**What changed that matters here: nothing in the Color Module.** A diff between the Third Editors' Draft (2025-07-21) and 2025.10 yields only boilerplate. **Cambium's color model has been frozen since July 2025 and the 2026 Preview threatens nothing.** What changed is the reference machinery—§7 expanded into the full JSON Pointer system, §6.4 `$extends` is new, §9.1 array aliasing is new, and the Resolver Module is entirely new.

### Theming: The Resolver Module Is Worth a Look

Cambium generates light and dark as a pair (spec stories 34–36), and 2025.10 has a standard shape for exactly that. Resolvers are a separate document type with their own schema: unconditional `sets` plus conditional `modifiers` (a `contexts` map with a `default`), composed via `resolutionOrder` and driven by an input like `{"theme": "dark"}`.

The load-bearing rule is §6.3: **aliases MUST NOT be resolved until after permutation flattening.** That means an alias can point at a token whose value differs per theme—precisely Cambium's semantic-aliases-onto-per-mode-primitives model.

Verified working in a browser bundle: `apply({scheme:'dark'})` and `apply({scheme:'light'})` resolve to different values, and `isValidInput({scheme:'nope'})` returns false.

Worth weighing against the spec note in Cambium's own issue that the Resolver feature is "sparsely implemented." That remains true of the ecosystem, but Terrazzo implements it today, and it is a cleaner target than inventing a mode convention.

### Recommended Stack

1. **Vendor the official `format.json`** (5.5 kB gz) with a refresh script and diff review. It is the only thing that scores 37/37.
2. **Precompile it with `ajv/dist/standalone` at build time** → **13 kB**, no `unsafe-eval`, Ajv stays a devDependency.
3. **`@terrazzo/parser` (55 kB)** for reading: alias chains, `$ref`, resolvers, modes. Externalize `node:fs/promises`; with Vite there is nothing to do. **Wire `RECOMMENDED_CONFIG` explicitly or you get no validation.**
4. **`@terrazzo/token-tools` (26 kB)** for writing—`parseColor()` is the CSS-string-to-DTCG primitive.
5. **Writing is `JSON.stringify`.** Validate the object before you stringify it.
6. **Wire the conformance suite into CI.** It caught four Terrazzo bugs and eleven styleframe ones in minutes, and it is the only way to know your exporter is actually conformant.

If bundle size is critical, token-tools plus the precompiled validator is **39 kB total** and still scores 37/37 on validation. You give up alias-graph resolution, which is roughly fifty lines for the common cases.

### What This Replaces

| Planned by hand | Replaced |
|---|---|
| Serializing tokens to DTCG JSON | `JSON.stringify`—genuinely |
| Building spec-shaped color `$value` objects | `parseColor()` from token-tools |
| Validating the export against the spec | official schema + precompiled Ajv |
| Resolving `{alias}` and `$ref` chains on import | `@terrazzo/parser` |
| Light/dark as one document | the 2025.10 Resolver Module |

**Remaining bespoke work: the mapping layer.** Deciding which tokens exist, what they are named, what aliases what, and what goes in `$extensions` is all Cambium's. That is the semantic contract, not serialization. The libraries handle the format; the format was never the hard part.

## 5. Image Color Extraction

Cambium wants this as a deterministic cross-check on the vision model and as a keyless fallback path (spec stories 9 and 10, the demo mode).

| Package | Version | Published | License | Gzip | Quantizes in | Verdict |
|---|---|---|---|---|---|---|
| `colorthief` | 3.5.0 | 2026-08-02 | MIT | **6.5 kB** | **OKLCH** | **Adopt** |
| `node-vibrant` | 4.0.4 | 2026-01-27 | MIT (asserted) | 5.3 kB | sRGB | **Adopt as second opinion** |
| `extract-colors` | 4.2.1 | 2025-08-04 | MIT | 2.3 kB | HSL | **Avoid**—dormant |
| `colorlip` | 1.0.0 | 2026-03-25 | MIT | 4.9 kB | CIELAB | **Watch**—one star, one author |
| `rothko` | 0.2.0 | 2026-04-05 | claimed MIT, **no LICENSE file** | 7.1 kB |—| **Avoid** |

### colorthief 3.5.0—Adopt

Ignore what you remember about color-thief. Version 3.x is a ground-up TypeScript rewrite and it is the healthiest package in this space.

**Published [2026-08-02](https://registry.npmjs.org/colorthief)**, six releases between March and August 2026, MIT with an actual LICENSE file, zero runtime dependencies, and, remarkably, **one open issue**, which is a PR. In July and August 2026 the maintainer closed a decade-old backlog including [#60](https://github.com/lokesh/color-thief/issues/60) (opened 2015) and [#176](https://github.com/lokesh/color-thief/issues/176) (opened 2019), and turned around a bundler-warning report in five days. That is the best issue responsiveness of any package in this entire survey.

**It quantizes in OKLCH by default.** This is the decisive technical point and it is easy to miss. The pipeline's default `colorSpace` is `'oklch'`, not `'rgb'`: pixels are converted to OKLCH before median-cut runs and converted back after. It is the only library here doing median-cut in a perceptually uniform space, with real sRGB↔linear↔OKLab math rather than an approximation. For Cambium, whose entire seed vocabulary is OKLCH, that alignment matters.

The quantizer itself is a faithful MMCQ (modified median cut, Leptonica lineage): 5 significant bits, a 32³ histogram, population-fraction-driven VBox splitting.

**The option that answers "brand color, not muddy average" is `minSaturation`.** It is in the shipped types (`internals.browser.d.ts`) though the README options table omits it. Set it around 0.25–0.4 and the near-grey dominant is filtered out before quantization. `getSwatches()` additionally returns Vibrant / Muted / DarkVibrant / DarkMuted / LightVibrant / LightMuted using Android Palette semantics.

**Import shape matters—there is no default export.** `import ColorThief from 'colorthief'` fails to bundle. Use named imports:

```ts
import { getSwatchesSync, getPaletteSync } from 'colorthief';

const bitmap = await createImageBitmap(file);
const sw = getSwatchesSync(bitmap, { colorSpace: 'oklch', minSaturation: 0.3, quality: 5 });
const seed = sw.Vibrant ?? sw.LightVibrant ?? sw.DarkVibrant
          ?? getPaletteSync(bitmap, { colorCount: 3 })?.[0];
```

Measured: 6.5 kB gzip for `getColorSync` + `getPaletteSync`, 7.0 kB adding `getSwatchesSync`, 8.2 kB for everything. It accepts `ImageBitmap` and `OffscreenCanvas` directly, so Cambium can run it in its own Web Worker. Note that the built-in `worker: true` option is deprecated in v3 and removed in v4: the README is honest about why: the structured clone of the pixel array cost more than it saved, and it quantized in RGB while the default path is OKLCH, so it returned different colors. Do your own worker.

Display-P3 is supported via `gamut: 'srgb' | 'display-p3' | 'auto'`, and `region: {x, y, width, height}` in 0–1 fractions lets you sample only where a logo sits—useful for spec story 17 (link seed values to the image region they came from).

Optional WASM quantizer ships as opt-in and is not bundled by default.

### node-vibrant 4.0.4—Adopt as a Second Opinion

**Published [2026-01-27](https://registry.npmjs.org/node-vibrant)**, MIT asserted in `package.json`—note there is **no LICENSE file in the repository** and the GitHub API reports `license: null`. Weaker provenance than colorthief's.

**Maintenance runs in yearly bursts and issues go unanswered.** Six open issues, five with zero comments, the oldest from December 2024. [Issue #184](https://github.com/Vibrant-Colors/node-vibrant/issues/184) (MMCQ quantizer ignoring histogram color count, July 2025) has sat fourteen months without reply.

**The suspicious `dist/esm/throw.js` main entry is worse than a hint—it is a literal runtime throw:**

```js
throw new Error('There is no default export in this module. Please use named imports like "node-vibrant/browser", …');
```

`import { Vibrant } from 'node-vibrant'` bundles "successfully" at 180 bytes and explodes at runtime. **The correct import is `import { Vibrant } from 'node-vibrant/browser'`.**

**Does `@vibrant/image-node` and `@types/node` poison the bundle? No, but they poison the install and the typing scope.** The `/browser` subpath bundles clean at 5.3 kB with no trace of jimp, pngjs, or node builtins. But `npm i node-vibrant` pulls roughly 6 MB of node-only dependencies you will never ship, and `@types/node@^18` is declared as a *runtime* dependency, which hoists into your typing scope—the classic symptom is `setTimeout` resolving to `NodeJS.Timeout` instead of `number`. [Issue #172, "Reduce v4 dependency tree,"](https://github.com/Vibrant-Colors/node-vibrant/issues/172) was closed in January 2025 without the tree actually being reduced.

If that bothers you, compose the scoped packages directly—same bundle size, ~6 MB less in `node_modules`:

```ts
import { Vibrant } from '@vibrant/core';
import { BrowserImage } from '@vibrant/image-browser';
import MMCQ from '@vibrant/quantizer-mmcq';
import { Default as generator } from '@vibrant/generator-default';
```

**Why keep it at all.** Its generator heuristics are the best-tuned thing here for finding a saturated identity color. The Android Palette port weights saturation at 3.0 and luma at 6.5 against population at **0.5**: population is deliberately discounted, which is exactly the bias that returns a brand color rather than the dominant background. Its quantizer is the weakest (plain 5-bit sRGB, nothing perceptual anywhere), but colorthief gives you the better quantizer *and* ships the same swatch semantics.

Running both and comparing costs about 12 kB combined. Disagreement between them is itself a useful signal: it means the image has no clear brand color, which is worth surfacing rather than hiding.

### The Rest

**`extract-colors` 4.2.1: avoid.** Published [2025-08-04](https://registry.npmjs.org/extract-colors), thirteen months stale. The `5.0.0-beta.1` published the same day is the preview of a colour-classification feature tracked in [issue #58](https://github.com/Namide/extract-colors/issues/58); the `feature/classify` branch last saw a commit on 2025-08-04, no `v5.0.0-beta.1` tag exists, and npm has no `next` dist-tag. The maintainer did one big push that day, cut a beta and a patch, and has not returned. The 5.x line is abandoned mid-flight.

Algorithmically it is also the weakest fit: a histogram with greedy merging on independent HSL thresholds, no perceptual space, no saturation targeting, no population weighting. On a photo with a large neutral background it returns precisely the muddy average Cambium is trying to avoid.

**`colorlip` 1.0.0: watch.** Conceptually the most Cambium-shaped thing found: composition-aware weighting with centre/border and edge heuristics, CIELAB ΔE merging, and a role-based API returning `dominant` / `accent` / `swatches` with OKLCH output. "Accent plus centre-weighting" is exactly the pick-the-logo-not-the-background heuristic. But the repo was created February 2026, has one star, one author, one release, and nothing since March. Prototype against it; do not depend on it.

**`rothko` 0.2.0: avoid.** `package.json` claims MIT but [the repository has no LICENSE file](https://github.com/zeakd/rothko.js) and the GitHub API reports `license: null`. Pre-1.0, one star, dormant since April 2026. An unlicensed repo with an MIT claim in a manifest is legally thin.

**`@thi.ng/pixel-dominant-colors`** is the only live k-means option (Apache-2.0, actively maintained), but it pulls a full image-processing framework, and k-means is non-deterministic across runs unless seeded—which directly undercuts the "deterministic cross-check" goal.

### The CORS Constraint: Confirmed and Absolute

Reading pixels requires `getImageData()`, which throws `SecurityError` on a canvas whose origin-clean flag has been cleared. Drawing a cross-origin image without successful CORS clears that flag permanently, and there is no way to un-taint a canvas.

Workable sources in a static app:

1. A local `File` or `Blob` from the picker or drag-drop. **Always safe.**
2. A same-origin image shipped with the bundle. Safe.
3. A remote image where `img.crossOrigin = 'anonymous'` is set **and** the server returns `Access-Control-Allow-Origin`. If either is missing, you get a tainted canvas.
4. A `data:` URI. Safe.

Note the asymmetry that catches people: setting `crossOrigin` when the server does not send CORS headers makes the image **fail to load entirely** rather than load and taint. Handle both the `error` event and the `SecurityError`.

**For Cambium this is a non-issue by construction.** The app already holds the image locally as a `File` to send to the vision model, and spec story 7 explicitly records the brand URL as metadata while never fetching the page. Route extraction off that same Blob and CORS never enters the picture.

### What This Replaces

| Planned by hand | Replaced |
|---|---|
| Quantizing an image to candidate colors | `colorthief` MMCQ in OKLCH |
| Filtering out muddy neutrals | `minSaturation` option |
| Vibrant/Muted swatch roles | `getSwatches()`, both libraries |
| Deciding which candidate is "the brand color" | **Nothing** |

**Remaining bespoke work: the judgement layer.** Both libraries return ranked candidates; neither returns a Brand Seed. Mapping candidates onto `proposedRole` (brand, accent, danger, …), deciding a neutral temperature, and detecting surface polarity are all Cambium's. The libraries replace the pixel math, which is the easy half.

Treat this as a cross-check rather than a replacement for the vision call. Extraction cannot tell you that a colour is a *logo* colour rather than a photographed wall, which is the whole reason stage 1 exists.

## 6. Font Metadata

The requirement: Google Fonts classification, category, stroke/serif classification, x-height, available weights and axes, for a browser app with no API key.

**No single keyless runtime source provides all of it.** The answer is a build-time snapshot plus one runtime-free npm package.

| Source | Keyless | Browser-fetchable | category | stroke / classification | axes | x-height |
|---|---|---|---|---|---|---|
| Developer API | **No—403** | yes (sends ACAO) | yes | no | yes (`capability=VF`) | **no** |
| `fonts.google.com/metadata/fonts` | yes | **No—CORS blocked** | yes | **yes, both** | yes | no |
| `google/fonts` METADATA.pb | yes | yes (via raw/jsDelivr) | yes | sparse | yes | no |
| `google/fonts` `tags/all/families.csv` | yes | **yes, ACAO `*`** |, | **scored, fine-grained** |—| no |
| `@capsizecss/metrics` | yes | bundled | yes | no | no | **yes** |

### The Developer API Requires a Key: Avoid

Verified directly. `https://www.googleapis.com/webfonts/v1/webfonts?sort=alpha` with no key:

```
403 PERMISSION_DENIED: Method doesn't allow unregistered callers (callers without
established identity). Please use API Key or other form of API consumer identity...
```

`?capability=VF` also returns 403. CORS is *not* the blocker: with an `Origin` header the response does carry `access-control-allow-origin`. The key is the blocker, and a key in a static bundle is public by construction. Referrer restrictions in Cloud Console are a soft control, not a secret.

It also would not be enough if it were keyless: it returns `category` but no `stroke`, no `classifications`, and **no font metrics of any kind**: no x-height, no cap-height, no unitsPerEm. There is nothing metric-shaped in the schema. See the [Developer API docs](https://developers.google.com/fonts/docs/developer_api).

### fonts.google.com/metadata/fonts: Rich, Keyless, and CORS-Blocked

This undocumented endpoint returns 2.7 MB of JSON with no key: 1,946 families, each carrying 23 fields including `category`, `stroke`, `classifications`, `axes`, `popularity`, `trending`, and per-weight `lineHeight`.

It is genuinely richer than anything else. `stroke` distinguishes `Slab Serif`, which `category` does not. But two problems.

**It is CORS-blocked. Verified:**

```
$ curl -sI -H "Origin: https://example.com" https://fonts.google.com/metadata/fonts
HTTP/2 200
content-type: application/json; charset=utf-8
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-site
```

No `Access-Control-Allow-Origin` header, and `cross-origin-resource-policy: same-site` on top. A `fetch()` from a static origin fails, and `mode: 'no-cors'` only buys an opaque response you cannot read.

**It is completely undocumented.** It appears nowhere in the Developer API docs; it is the internal backing API for the fonts.google.com catalogue UI. No versioning, no stability contract, no deprecation policy. Google can change or remove it without notice.

It also carries no x-height. The per-weight `fonts` object has `lineHeight`, `thickness`, `slant`, and `width`, and the last three were `null` on every weight of Inter.

**Verdict: unusable at runtime, risky as a live dependency, but ideal as a build-time input you snapshot and vendor.**

### google/fonts METADATA.pb—Useful, With a Licensing Gap

Per-family protobuf-text files. A real example (`ofl/inter/METADATA.pb`) carries `name`, `designer`, `license`, `category: "SANS_SERIF"`, `date_added`, per-style `fonts{}` blocks, `subsets`, `axes { tag min_value max_value }`, `source{}`, and `minisite_url`. Each family directory also has a `DESCRIPTION.en_us.html`.

**The gotcha: `stroke` and `classifications` are sparse.** Playfair Display carries `category: SERIF` + `stroke: SERIF` + `classifications: DISPLAY`: a genuinely richer two-axis model. But **Inter, the most-used family in the collection, has neither field.** Any classification built on `stroke` must fall back to `category`. Schema reference: [googlefonts/gf-docs METADATA](https://github.com/googlefonts/gf-docs/tree/master/METADATA).

**The better aggregate is `tags/all/families.csv`**—33,755 rows of `family, axis-position, tag, score`:

```csv
Inter,,/Sans/Neo Grotesque,100
Inter,,/Sans/Geometric,20
Inter,,/Expressive/Competent,91
Inter,,/Expressive/Calm,80
Inter,wght@900,/Expressive/Loud,85
Inter,,/Quality/Spacing,90
```

The taxonomy covers `/Sans/{Geometric, Humanist, Neo Grotesque, Rounded, Glyphic}`, `/Serif/{Modern, Transitional, Old Style Garalde, Fat Face}`, `/Expressive/{Business, Sincere, Vintage, Futuristic, Wacky, Cute, Loud, Competent, …}`, plus `/Theme`, `/Purpose`, and `/Quality`—each scored 0–100, and some scores are per-weight.

**For Cambium this is far more valuable than `category`.** The Brand Seed carries a `tone` of geometric / humanist / grotesque and needs three ranked font candidates with rationale (spec stories 46 and 47). `/Sans/Neo Grotesque: 100` maps onto that directly; `category: "Sans Serif"` does not. 1.3 MB raw, **154 kB gzipped**, or 101 kB gz for family-level rows only.

It is also the one Google Fonts data source that genuinely works from a browser. Verified:

```
$ curl -sI -H "Origin: https://example.com" \
    https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv
HTTP/2 200
access-control-allow-origin: *
```

Pin a commit SHA rather than `@main` if you fetch at runtime.

**The licensing flag, stated plainly.** [google/fonts](https://github.com/google/fonts) has **no root LICENSE file** and the GitHub API reports `license: null`. The README scopes its licence discussion entirely to the font binaries: "The top-level directories indicate the license of all files within them… Each font family directory contains the appropriate license file for the fonts in that directory." **Nothing states a licence for the METADATA.pb files or for `tags/all/families.csv`.**

The pragmatic case is strong: these are descriptive facts (family names, category strings, numeric ranges, numeric scores), facts are generally not copyrightable, the repository exists expressly so third-party distributors can consume it, and Fontsource, Capsize, and every Google-Fonts-adjacent tool already redistribute derivatives. But there is no explicit grant. If Cambium ever ships commercially, route this past whoever handles licence review rather than letting "it's Google, it's fine" carry it. Note also that `cc-by-sa/` exists as a top-level directory, so not every font in the repo is permissively licensed either.

### @capsizecss/metrics—Adopt; the Only Source With X-Height

**Version 4.3.0, published [2026-09-15](https://registry.npmjs.org/@capsizecss/metrics): yesterday.** MIT, confirmed by both the shipped LICENSE file and the GitHub API. Maintained by SEEK's OSS team rather than an individual, with a scheduled regeneration job—recent commits are literally `metrics: Update Google Fonts (#270)`. Release cadence through 2026: March, May, June, July, September.

Each family record:

```js
{
  familyName: 'Inter', category: 'sans-serif',
  capHeight: 1490, ascent: 1984, descent: -494, lineGap: 0,
  unitsPerEm: 2048,
  xHeight: 1118,
  xWidthAvg: 978,
  subsets: { latin: { xWidthAvg: 978 }, thai: { xWidthAvg: 1344 } }
}
```

**x-height, cap-height, ascent, descent, lineGap, unitsPerEm, and category**: everything the Brand Seed's `typeClassification.xHeight` field needs, for **1,969 families** including system fonts (`arial`, `georgia`, `appleSystem`), at **per-weight and per-style granularity** (`inter/400`, `inter/700italic`).

**Tree-shaking is excellent**, via a wildcard export. Measured:

| Import | Gzip |
|---|---|
| one family (`@capsizecss/metrics/inter`) | **224 B** |
| three families | 351 B |
| `entireMetricsCollection` | **255 kB—never do this** |

The package ships the dynamic-import pattern for exactly this use case:

```ts
import { fontFamilyToCamelCase } from '@capsizecss/metrics';
const m = await import(`@capsizecss/metrics/${fontFamilyToCamelCase(family)}`);
const xHeightRatio = m.default.xHeight / m.default.unitsPerEm;   // Inter -> 0.546
```

With Vite that produces a code-split chunk per family and keeps the initial bundle flat. Install footprint is ~130 MB because every family × variant is its own directory, but none of it ships.

### What Not to Use

**`google-font-metadata` 6.0.8**—MIT, [Fontsource-maintained](https://github.com/fontsource/google-font-metadata), data auto-refreshed monthly. But it installs 55 MB, exports a single root entry with no subpaths, has zero tree-shaking, and its runtime dependencies include **Playwright**. It is a scraper CLI, not a library.

**One file inside it is genuinely useful, though.** `data/api-response.json` is a keyless mirror of the Developer API response, 454 kB raw, **27.5 kB gzipped**, and jsDelivr serves it with open CORS:

```
$ curl -sI -H "Origin: https://example.com" \
    https://cdn.jsdelivr.net/npm/google-font-metadata@6.0.8/data/api-response.json
HTTP/2 200
access-control-allow-origin: *
```

That is a legitimate keyless runtime path to `category` + `variants` + `subsets`, version-pinned. It lacks `stroke`, `classifications`, and axes.

**`google-fonts-complete`**, dead since 2023. **`google-fonts-helper`**, builds `<link>` URLs, carries no classification data. **`fontsource` (bare)**, a security placeholder; do not install. **`@fontsource/*`**, ships fonts, not metadata, under OFL-1.1, which is fine for fonts but is not a permissive code licence.

### Recommendation

Build the dataset at build time, ship it as static JSON, and no key, API, or CORS enters the runtime.

| Layer | Source | Shipped gzip |
|---|---|---|
| Classification + axes, 1,946 families | build-time snapshot of `fonts.google.com/metadata/fonts`, projected | **18 kB** |
| Scored mood/style tags (recommended) | `google/fonts tags/all/families.csv`, collapsed to top-N per family | ~30 kB |
| Metrics incl. x-height | `@capsizecss/metrics`, dynamic import per family | **224 B each** |

**Under 50 kB gzipped for the whole font-intelligence layer.** Projecting the metadata snapshot to `{family, category, stroke, classifications, axes, weights}` measures 238 kB raw and 18.2 kB gzipped for all 1,946 families.

Because the metadata endpoint is undocumented, make the build step fail loudly if the shape changes and keep the last-good snapshot committed—a Google-side change can then make your data stale but can never break your build. That fits Cambium's existing fixture-script pattern (spec story 73).

## 7. Browser Plumbing

### 7a. IndexedDB—idb, Not dexie

**`idb` 8.0.3: adopt.** ISC, published [2025-05-07](https://registry.npmjs.org/idb), zero dependencies, types bundled, ESM and CJS. **1.5 kB gzip.** At that size the tree-shaking question is moot; the whole library is smaller than most single functions.

The quiet release history looks like abandonment from outside. Jake Archibald answered [issue #349](https://github.com/jakearchibald/idb/issues/349) on 2025-09-23 and [issue #299](https://github.com/jakearchibald/idb/issues/299) on 2026-03-25. The library is a thin promise wrapper over a frozen platform API; there is very little left to change. Treat the silence as completion.

One rough edge to plan around: transaction aborts. [Issue #166](https://github.com/jakearchibald/idb/issues/166) and [PR #338](https://github.com/jakearchibald/idb/pull/338) (open since November 2025) cover `AbortError` handling, which bites hardest on iOS when WebKit suspends and kills transactions mid-flight. Write your own error handling around aborts rather than assuming the wrapper covers it. That matters for Cambium because spec story 60 makes every generation an immutable version—a silently aborted write loses a version.

**`dexie` 4.4.6: avoid.** Apache-2.0, published [2026-09-10](https://registry.npmjs.org/dexie), genuinely well maintained. Two findings, one of which corrects a common assumption:

The 3.2 MB unpacked figure is misleading—roughly 1.43 MB of it is sourcemaps. **What actually ships is 32.8 kB gzip.** But it does not tree-shake: `import Dexie` and `import * as dexie` measure within 80 bytes of each other, because there is no `sideEffects: false` and the `exports` map resolves to a single prebuilt bundle rather than separable modules. Dexie is a class-based ORM; you take the engine or nothing.

The Dexie Cloud question is clean. The LICENSE file is verbatim Apache-2.0 and the NOTICE is plain attribution; [Dexie Cloud](https://dexie.org/cloud/) is a separate paid product referenced only in README marketing. The one real obligation is Apache-2.0 §4(d): propagate the NOTICE file if you redistribute. A chore an MIT-only stack does not have.

For Cambium's workload, brand seeds, token sets, thumbnails as Blobs, Dexie's 32 kB buys compound indexes, live queries, schema migrations, and a query DSL. Cambium has none of those problems.

**Do you need IndexedDB at all?** Yes, and the Blobs decide it. `localStorage` is synchronous, string-only, and capped near 5 MB; storing thumbnails there means base64, which inflates them about a third and blocks the main thread on every read. IndexedDB stores Blobs natively. Once `idb` costs 1.5 kB, one storage layer beats two.

**Call the Storage API.** Without `navigator.storage.persist()`, the origin's data is best-effort and eviction-eligible under pressure: a user can silently lose saved token sets, which directly contradicts spec stories 58 and 60. Per [MDN's compat data](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json), `persist()` is available in Chrome 55, Firefox 57, and Safari 15.2; `estimate()` in Chrome 61, Firefox 57, Safari 17. Call `persist()` once the user saves their first brand seed, and use `estimate()` to serve spec story 65 (show storage use). A few lines, no dependency.

### 7b. fake-indexeddb for Node Tests—Still Required

**`fake-indexeddb` 6.2.5: adopt.** Apache-2.0, published [2025-11-07](https://registry.npmjs.org/fake-indexeddb), zero dependencies. The documented pattern is unchanged: `import 'fake-indexeddb/auto'` in a Vitest `setupFiles` entry. Since v4 it reuses TypeScript's built-in IndexedDB types rather than generating its own, so app types do not conflict.

There is no platform replacement, and the negative is clean:

- **Node does not ship IndexedDB.** Node 26's [globals documentation](https://nodejs.org/api/globals.html) lists no `indexedDB` and no `IDBFactory`, despite Node having added `CompressionStream`, `WebSocket`, `URLPattern`, and Web Storage. The only tracking issue, [nodejs/node#40045](https://github.com/nodejs/node/issues/40045), was closed in April 2023 with no implementation.
- **jsdom does not.** [Issue #1748, "Implement IndexedDB,"](https://github.com/jsdom/jsdom/issues/1748) is still open.
- **happy-dom does not.**

### 7c. Zip—fflate, Importing Only What You Need

**`fflate` 0.8.3: adopt.** MIT, published [2026-05-16](https://registry.npmjs.org/fflate), zero dependencies, `sideEffects: false`, proper browser/node export conditions, types bundled. Tree-shaking is real:

| Import | Gzip |
|---|---|
| `zipSync` + `strToU8` | **4.6 kB** |
| `unzipSync` | 3.0 kB |
| async `zip` (worker-backed) | 5.6 kB |
| everything | 12.6 kB |

**The republish anomaly is resolved, and it is a point in fflate's favour.** Versions 0.4.9, 0.5.4, 0.6.11, and 0.7.5 were published on 2026-07-20 within seconds of each other. They are coordinated security backports for [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) (CVE-2026-45820, medium, published 2026-07-22): `unzipSync()` enters an infinite loop on a crafted ZIP whose central directory declares the ZIP64 sentinel `compressed_size=0xFFFFFFFF` without the required `0x0001` extra field. The maintainer patched every supported release line two days *before* the advisory went public—textbook coordinated disclosure. Diffing the tarballs confirms the fix is present (`z64e` gains a length-bound parameter in 0.7.5) and that no files were injected.

Cambium is almost certainly unaffected regardless: the bug is in parsing untrusted archives. Cambium emits zips (spec story 57) and imports only its own exports (story 64).

**`jszip` 3.10.2—avoid.** Published [2026-09-08](https://registry.npmjs.org/jszip) after sitting since 2022. That release is a maintenance revival, not a security fix—CI migration, Node 18+ Blob support, cross-realm type detection, missing `defaults` types. Good to see; 385 issues still open.

Two corrections worth recording. The dual `(MIT OR GPL-3.0-or-later)` license is **disjunctive**—you choose MIT and the GPL arm is irrelevant. And the `readable-stream` bloat is real but *inside* the 30.3 kB rather than additive: jszip's `browser` field redirects to a prebuilt UMD bundle with those dependencies already baked in, so a bundler pulls exactly one input. The consequence is worse than the bloat—an opaque UMD blob with no `module` field and no `exports` map means **zero tree-shaking**. You pay 30.3 kB to zip three text files, against fflate's 4.6 kB.

**`client-zip` 2.5.1: situational.** MIT, published [2026-09-14](https://registry.npmjs.org/client-zip), healthy repo, the smallest at 2.5 kB gzip. But its own README states it "does *not* compress the files or unzip existing archives": it writes STORE-method archives only. For Cambium's payload of JSON, CSS, and Markdown, which compresses five to ten times over, that trades a much larger download for 2 kB of JavaScript. Wrong trade.

**Can the platform do it?** No. Per the [WHATWG Compression spec](https://compression.spec.whatwg.org/#dom-compressionstream-compressionstream), `CompressionStream` accepts `gzip`, `deflate`, `deflate-raw`, `brotli`, and `zstd`. Those are compression *algorithms*; a zip file is a *container*: local headers, central directory, end-of-central-directory record, CRC-32 checksums. The platform gives you one of five parts and exposes no CRC-32. Hand-rolling the rest is exactly the class of off-by-one code that produced the advisory above.

**Minimum correct answer: `fflate`, importing `zipSync` and `strToU8`. 4.6 kB.**

```js
import { zipSync, strToU8 } from 'fflate';
const zipped = zipSync({
  'tokens.json': strToU8(JSON.stringify(tokens, null, 2)),
  'globals.css': strToU8(css),
}, { level: 6 });
```

Reach for the async `zip()` only if the payload is large enough to jank the main thread.

### 7d. Image Downscaling—Ship Zero Dependencies

**`browser-image-compression` 2.0.2—avoid. Staleness is the least of it.**

It is dead: last publish [2023-03-06](https://registry.npmjs.org/browser-image-compression), last commit the same day, 65 open issues, [PR #51 open since 2020](https://github.com/Donaldcwl/browser-image-compression/pull/51), no maintainer replies on the tracker. Its only dependency, `uzip@0.20201231.0`, was last published on the last day of 2020.

The disqualifier is in the shipped source. `dist/browser-image-compression.mjs` contains:

```js
libURL = o.libURL || "https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"
...
self.importScripts(imageCompressionLibUrl)
```

**With `useWebWorker` true, the v2 default, it calls `importScripts()` against jsDelivr at runtime.** For a static, offline-capable, no-server app that is three failures at once: it introduces a hard third-party network dependency, it breaks any strict CSP, and it executes whatever that URL serves forever, outside your lockfile and outside SRI. Users filed [#225](https://github.com/Donaldcwl/browser-image-compression/issues/225) and [#188](https://github.com/Donaldcwl/browser-image-compression/issues/188) about it; both are unanswered.

**`pica` 10.0.3: watch; healthy, probably unnecessary.** MIT, published [2026-08-15](https://registry.npmjs.org/pica), only 5 open issues, three releases in 2026. A genuinely well-run project. Its default `mks2013` filter does resize and sharpening in one pass; Lanczos is available via `{ filter: 'lanczos3' }`. It costs 16.6 kB gzip, and its WASM ships inlined as base64 rather than as a separate asset—good for static hosting, but it **requires `'wasm-unsafe-eval'` in the CSP `script-src`**.

**The platform is good enough here, and pica's own README says why the alternative is risky.** From [MDN compat data](https://github.com/mdn/browser-compat-data/blob/main/api/_globals/createImageBitmap.json):

| Option | Chrome | Firefox | Safari |
|---|---|---|---|
| `createImageBitmap` | 50 | 42 | 15 |
| `resizeWidth` / `resizeHeight` | 54 | 98 | 15 |
| `resizeQuality` | 54 | **149** | 15 |

Safari is not the laggard, contrary to the usual assumption—Firefox is, and only for `resizeQuality`, which landed in Firefox 149 (March 2026). Firefox ESR 140 accepts the option and silently ignores it, falling back to lower-quality resampling.

pica's README is candid that native resize quality is unspecified: its resize feature "is blocked in the default pica config… The result with `cib` enabled will depend on your browser." `resizeQuality: 'high'` is a hint, not a contract.

**Verdict for Cambium: use the platform.** The consumer of these images is a vision model, not a human retina. Resampling softness at 1024px sits well below what a vision model resolves, and most vision APIs resize to their own tile grid on arrival anyway. Paying 16.6 kB plus a `wasm-unsafe-eval` CSP relaxation to win a difference the consumer cannot perceive is a bad trade.

```ts
async function downscale(file: Blob, maxEdge = 1024): Promise<Blob> {
  const probe = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(probe.width, probe.height));
  probe.close();
  if (scale === 1) return file;              // already small; don't re-encode

  const bmp = await createImageBitmap(file, {
    resizeWidth: Math.round(probe.width * scale),
    resizeHeight: Math.round(probe.height * scale),
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
}
```

`createImageBitmap` decodes off the main thread, which is the real advantage over `ctx.drawImage` on a plain canvas—that path decodes synchronously and janks the UI on large photos. It also honours EXIF orientation by default. Call `.close()`; iOS has hard canvas memory limits, documented in [pica's wiki](https://github.com/nodeca/pica/wiki/iOS-Memory-Limit).

Revisit pica only if thumbnails get displayed at high DPI and softness draws complaints.

**One gap to plan for: HEIC.** iPhone uploads are frequently HEIC, and neither `createImageBitmap` nor pica can decode it. Spec story 6 (reject unsupported types at the picker with a plain message) is the cheap answer; a decoder is a separate project.

## 8. Testing: axe-core and Vitest

### Current Versions

| Package | Version | Published | License |
|---|---|---|---|
| `vitest` | **5.0.1** | 2026-09-15 | MIT |
| `@vitest/browser` | 5.0.1 | 2026-09-15 | MIT |
| `@vitest/browser-playwright` | 5.0.1 | 2026-09-15 | MIT |
| `axe-core` | 4.13.0 | 2026-08-05 | MPL-2.0 |
| `@axe-core/playwright` | 4.13.0 | 2026-08-11 | MPL-2.0 |
| `jest-axe` | 11.0.0 | 2026-07-26 | MIT |
| `vitest-axe` | **0.1.0** | **2022-10-21** | MIT |

### vitest-axe—Avoid, and It Is Worse Than Stale

This is the trap. The `latest` dist-tag points at **0.1.0, published 2022-10-21**: a plain `npm i vitest-axe` installs a four-year-old package whose peer dependency is `vitest: >=0.16.0`. The usable build, `1.0.0-pre.5`, sits under the `pre` tag from 2025-01-22 and was never promoted; its peer range predates Vitest 2, 3, 4, and 5. Confirmed in the [registry metadata](https://registry.npmjs.org/vitest-axe).

The [repository](https://github.com/chaance/vitest-axe) last saw a commit on 2025-02-11. [Issue #17, "request: publish v1.0.0,"](https://github.com/chaance/vitest-axe/issues/17) collects unanswered pings from January 2025, July 2025 ("are you still maintaining this?"), January 2026, and February 2026, with no maintainer reply. Open incompatibilities include jsdom v28 (jsdom is now 30) and happy-dom.

It still pulls roughly a million downloads a week, which is precisely what makes it dangerous—popularity masking abandonment.

### The Right Setup in 2026: axe-core Directly, in Browser Mode

**Vitest browser mode is stable.** The [official guide](https://vitest.dev/guide/browser/) carries no experimental banner for v5. Note the v5 packaging change: providers are separate packages now, and the provider is imported rather than named by string.

```ts
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    browser: { provider: playwright(), enabled: true, instances: [{ browser: 'chromium' }] },
  },
});
```

**Running axe in a real browser is a correctness requirement, not a nicety.** axe-core measures *rendered* accessibility: computed color, layout, stacking, visibility. jsdom and happy-dom do no layout and no cascade resolution, so the entire `cat.color` rule family, `color-contrast` included, is unreliable or inert there. That is the root cause behind vitest-axe's DOM-implementation issues, and it is the rule family Cambium cares about most.

No maintained successor to `vitest-axe` has emerged, and that is informative: with browser mode stable, the wrapper package is obsolete. Call `axe.run()` and assert on the result. A ten-line local matcher replaces the dead dependency.

`jest-axe` 11.0.0 (MIT, [2026-07-26](https://registry.npmjs.org/jest-axe), [actively maintained](https://github.com/NickColley/jest-axe)) is the fallback if you are committed to jsdom. It works under Vitest because Vitest implements a Jest-compatible `expect.extend`. Two papercuts: it is CJS-only, and it ships no types—`@types/jest-axe` is stuck at 3.5.9 from 2023, eight majors behind.

### axe-core's MPL-2.0 Licence

Flagging it was right; for Cambium it is a non-issue.

MPL-2.0 is **file-level** copyleft. Obligations attach to *distribution*, and test files never ship. In `devDependencies` there is nothing to comply with. Even bundled, §3.3 lets you distribute a Larger Work under terms of your choice provided the covered files themselves stay under MPL—for axe-core that means pointing at its public repository. Your code is unaffected. This is categorically unlike the GPL arm of jszip's dual license.

Keep axe-core in `devDependencies` and the question never arises.

### Should axe-core Test the Generated Color Tokens? No

This would be a category error, for three concrete reasons.

**axe-core has no usable standalone contrast function.** The internals live under `axe.commons`, and axe's own [API documentation](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md) states that `axe.setup()` is required to build the `VirtualNode` tree before those functions run. Asserting one token pair would mean mounting DOM nodes, styling them, and running a full rule pass—to divide two luminance numbers.

**The generator is a pure function, so test it like one.** Cambium's stage 2 is explicitly deterministic and network-free. Unit tests on `wcagContrast` run in microseconds, report the exact ratio on failure, and can exhaustively check *every* declared pair against *every* background—coverage axe could never reach, because axe only sees what you rendered.

**The two tests answer different questions, and Cambium wants both.**

| Question | Tool | Scope |
|---|---|---|
| Does the generator emit AA-passing pairs? | plain Vitest on the contrast math | exhaustive, every commit |
| Does the shipped UI render accessibly? | axe-core in browser mode | cascade overrides, text over gradients, opacity layers, disabled states |

Testing tokens through axe gives the slowest possible version of the first question and none of the coverage of the second.

### Recommended Setup

```jsonc
{
  "devDependencies": {
    "vitest": "^5.0.1",
    "@vitest/browser": "^5.0.1",
    "@vitest/browser-playwright": "^5.0.1",
    "playwright": "^1.50.0",
    "axe-core": "^4.13.0",
    "fake-indexeddb": "^6.2.5"
  }
}
```

Token contrast assertions go in plain Vitest against the math. Rendered-component a11y goes through `axe.run()` in browser mode, which also serves spec story 76 (the app itself must be keyboard navigable and screen-reader usable). IndexedDB tests get `import 'fake-indexeddb/auto'` in `setupFiles`.

**Do not install** `vitest-axe` or `@types/jest-axe`.

## Rollup: The Bundle, and What Is Actually Left to Build

### Recommended Dependency Set

| Purpose | Package | Gzip |
|---|---|---|
| Color math, gamut mapping, WCAG contrast | `culori/fn` | 8.0 kB |
| Advisory APCA | `chroma-js` `contrastAPCA` (or port ~30 lines) | 17.2 kB / 0 |
| DTCG reading, alias resolution | `@terrazzo/parser` | 54.9 kB |
| DTCG writing | `@terrazzo/token-tools` | 25.8 kB |
| DTCG validation | precompiled Ajv + vendored `format.json` | 13.0 kB |
| Image extraction | `colorthief` | 6.5 kB |
| Second-opinion extraction | `node-vibrant/browser` | 5.3 kB |
| Persistence | `idb` | 1.5 kB |
| Zip export | `fflate` (`zipSync`) | 4.6 kB |
| Image downscaling | platform `createImageBitmap` | 0 |
| Font classification | build-time JSON snapshot | 18 kB |
| Font style tags | collapsed `families.csv` | ~30 kB |
| Font metrics | `@capsizecss/metrics`, dynamic per family | 224 B each |

Roughly **185 kB gzipped** if you take everything, and the two largest line items are both Terrazzo. The minimum viable set, culori, token-tools, precompiled Ajv, colorthief, idb, fflate, is about **60 kB**, with font data code-split.

Nothing in this list is copyleft, GPL, or field-of-use restricted, provided you skip `apca-w3` and take jszip's MIT arm if you were ever tempted by it. axe-core's MPL-2.0 stays in `devDependencies`.

### What the Libraries Genuinely Replace

Color conversion, gamut mapping, contrast measurement, DTCG parsing and validation, alias resolution, image quantization, zip, IndexedDB, image downscaling, and font metrics. All of it is a solved dependency problem. Roughly a day of integration work.

### What Genuinely Remains Bespoke

Ranked by how much of the project they represent:

1. **The L and C curves per step, per mode, per interpretation preset.** No library encodes Radix step semantics, because Radix has never published them numerically—one APCA guarantee for steps 11 and 12 and prose for everything else. This is the project. It is a taste problem with a visual regression harness, not a math problem.
2. **The dark ramp derived independently against the same step roles.** Spec story 35 rules out inversion. Nothing helps.
3. **The neutral ramp from a temperature hint, and accent derivation by hue rotation.** Nothing helps.
4. **Mapping extracted or model-returned colors onto proposed roles.** Extraction gives ranked candidates; the Brand Seed needs roles, polarity, and temperature.
5. **The semantic contract.** Which tokens exist, what they are named, what aliases what, and what goes in `$extensions`. Format is solved; the contract is not.
6. **Provenance and rationale.** Spec stories 29–32 have no prior art at all.

The contrast repair loop, the thing the spec frames as hard, is about fifteen lines on culori and was verified to land on 4.500 exactly. The twelve-step generator plus repair prototyped at **27 lines** and produced sane ramps across the hue circle on the first attempt.

### The One Finding That Should Change the Plan

The spec names generating a twelve-step scale that "actually hits those perceptual targets" as the principal technical risk. The research says the risk is real but differently shaped: **there are almost no published targets to hit.**

Radix documents one numeric guarantee (steps 11 and 12 at Lc 60 and Lc 90 APCA against step 2), states it in APCA rather than WCAG, and its own hand-tuned scales have failed the previous WCAG-stated version of that guarantee since February 2024 without a fix. The reference implementation is therefore a **taste** target, not a correctness one, and Cambium cannot validate against it.

Two practical consequences. Budget the time for defining and defending a step-role target table, because that artifact does not exist anywhere and Cambium has to invent it. And be careful in the product copy: repairing to WCAG 2.2 AA is the right call—APCA appears nowhere in the [WCAG 3.0 Working Draft of 10 September 2026](https://www.w3.org/TR/wcag-3.0/), which states outright that "the contrast algorithm used in WCAG 3 is yet to be determined"—but it means Cambium implements a different guarantee from the one Radix documents. Say so rather than implying Radix compliance.
