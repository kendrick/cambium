import { contrastAPCA } from 'chroma-js';
import { formatHex } from 'culori/fn';

// ADR-0003 puts culori mode registration in one module and keeps it there. Importing the core's
// colour module for its side effect is what makes this harness measure through the same registered
// set the engine uses, rather than a second set that could drift out of step with it.
import { contrastFromOklch, isInSrgb, readOklch, renderedContrast } from '../../core/oklch.ts';

/**
 * APCA comes from chroma-js because `apca-w3` is patent-pending, restricted by field of use, and
 * carries an AGPL fallback. chroma-js reimplements the published formula under BSD-3 and matches
 * the reference to the last decimal in both polarities. It stays in this dev-only script and out
 * of the engine, where it would cost 17.2 kB gzip for one function.
 */
function apcaOf(color, background) {
	return contrastAPCA(formatHex(color), formatHex(background));
}

/**
 * One step, measured rather than declared. Contrast is stated against step 2 because that is the
 * background Radix states its single published guarantee against, which makes the figures here
 * comparable to the only number Radix actually commits to. It is also the background
 * `core/step-roles.ts` states every floor against, so the same measurement doubles as the
 * evaluation harness's pass/fail check when `stepRole` is supplied.
 *
 * `wcag` and `failsContrast` are measured over the 8-bit sRGB pair the cell paints rather than over
 * `oklch`'s full-precision channels, through the same `renderedContrast` the engine solves against.
 * Sharing that function is the point. A harness whose job is judging the colour a person sees must
 * not hold a second opinion about what that colour is, and holding one is how #72 stayed invisible
 * from this side. The full-precision figure is measured again, lazily, only when `stepRole` declares
 * a floor to compare it against (see `straddlesFloor` below) — the Radix and Tailwind taste
 * reference in
 * `scripts/swatches.mjs` calls this with no `stepRoles` at all, and a second contrast measurement
 * nobody reads on every one of those cells would be waste.
 */
function measureStep(step, color, background, stepRole) {
	const oklch = readOklch(color);
	const backgroundOklch = readOklch(background);
	const hex = formatHex(color);
	const wcag = renderedContrast(oklch, backgroundOklch);

	const floor = stepRole?.minWcagVsStep2 ?? null;
	const failsContrast = floor != null && wcag < floor;
	// A step whose full-precision colour and whose rendered hex disagree about the floor is fragile
	// in a way no amount of looking at this one swatch reveals: the next release of culori, or a
	// different rounding path, could tip it either way. Surfacing that is worth more than silently
	// filing it under "fails" or "passes".
	const exactFails = floor != null && contrastFromOklch(oklch, backgroundOklch) < floor;
	const straddlesFloor = floor != null && exactFails !== failsContrast;

	return {
		step,
		hex,
		l: oklch.l,
		c: oklch.c,
		h: oklch.h,
		wcag,
		apca: apcaOf(color, background),
		inSrgb: isInSrgb(oklch),
		role: stepRole?.role ?? null,
		failsContrast,
		straddlesFloor,
	};
}

/**
 * Takes colors in any form culori parses and returns them measured in OKLCH, each carrying its
 * contrast against the ramp's own step 2. Ramps of other lengths are accepted on purpose: the
 * Tailwind reference runs eleven positional stops and comparing its curve is the entire reason
 * it is rendered at all.
 *
 * `stepRoles` is optional and positional, one entry per color at the same index (`STEP_ROLES`
 * from `core/step-roles.ts` already runs step 1 to 12 in order, so passing it straight through
 * lines up). Omitting it is what keeps this function's other caller, the Radix/Tailwind taste
 * reference in `scripts/swatches.mjs`, unchanged: those scales have no step-role table of their
 * own to check against.
 */
export function measureRamp(colors, stepRoles) {
	const background = colors[1] ?? colors[0];

	return colors.map((color, index) =>
		measureStep(index + 1, color, background, stepRoles?.[index]),
	);
}

// measureRamp takes anything culori parses; a Cambium ramp step is `{ step, l, c, h }`, one field
// short of the `{ mode, l, c, h }` shape culori actually wants. Exported here rather than
// redefined at each call site, since this module already owns the shape measureRamp expects.
export const asCulori = (step) => ({ mode: 'oklch', l: step.l, c: step.c, h: step.h });

const cellText = (step) => (step.wcag >= 4.5 ? '#ffffff' : '#111111');

/**
 * `toFixed` rounds, so a `wcag` of 4.4997 prints "4.50" against a 4.5 floor: a cell the floor
 * check already marked failing would read as clearing it. Every floor `STEP_ROLES` declares is
 * exact at two decimal places, so truncating toward zero instead of rounding is what guarantees
 * the printed figure can never land on the far side of a floor the value itself didn't clear.
 */
const truncate = (value, places) => {
	const factor = 10 ** places;
	return Math.floor(value * factor) / factor;
};

function renderCell(step) {
	const l = step.l.toFixed(3);
	const c = step.c.toFixed(3);
	const h = step.h.toFixed(1);
	const wcag = truncate(step.wcag, 2).toFixed(2);
	const gamut = step.inSrgb ? '' : ' <span class="warn">!</span>';
	const fail = step.failsContrast ? ' <span class="warn">fails floor</span>' : '';
	const straddle = step.straddlesFloor
		? ' <span class="straddle-mark">quantization-sensitive</span>'
		: '';
	const cellClass = [
		'cell',
		step.failsContrast ? 'fail' : '',
		step.straddlesFloor ? 'straddle' : '',
	]
		.filter(Boolean)
		.join(' ');

	return `<div class="${cellClass}" style="background:${step.hex};color:${cellText(step)}">
		<b>${step.step}</b>
		${step.role ? `<span class="role">${step.role}</span>` : ''}
		<span>${l} / ${c} / ${h}</span>
		<span>${wcag}:1${gamut}${fail}</span>
		<span>Lc ${Math.round(step.apca)}</span>
		${straddle}
	</div>`;
}

function renderRow(row) {
	return `<div class="row"><div class="label">${row.label}</div>
	<div class="ramp">${row.steps.map(renderCell).join('')}</div></div>`;
}

function renderGroup(group) {
	return `<section><h2>${group.title}</h2>
	${group.note ? `<p class="note">${group.note}</p>` : ''}
	${group.rows.map(renderRow).join('')}</section>`;
}

const STYLE = `
	body { margin:0; padding:24px; background:#0b0b0c; color:#e8e8ea;
		font:13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
	h1 { font-size:16px; margin:0 0 4px; }
	h2 { font-size:13px; font-weight:600; margin:28px 0 8px; color:#a8a8b0; }
	.note { margin:0 0 10px; color:#7a7a84; max-width:70ch; }
	.row { display:flex; align-items:stretch; gap:8px; margin-bottom:3px; }
	.label { width:13ch; flex:none; display:flex; align-items:center;
		justify-content:flex-end; color:#a8a8b0; }
	.ramp { display:flex; flex:1; gap:2px; }
	.cell { flex:1; min-width:0; padding:6px 4px; display:flex; flex-direction:column;
		gap:1px; font-size:10px; overflow:hidden; }
	.cell b { font-size:11px; }
	.cell .role { opacity:0.75; }
	/* .fail must stay declared after .straddle: a cell can carry both classes, and same-specificity
	   source order is what makes the solid red outline win over the dashed amber one when it does. */
	.cell.straddle { outline:2px dashed #e8b339; outline-offset:-4px; }
	.cell.fail { outline:2px solid #ff5c5c; outline-offset:-2px; }
	.warn { color:#ff5c5c; font-weight:700; }
	.straddle-mark { color:#e8b339; font-weight:700; }
	@media (max-width:900px) { .cell span { display:none; } }
`;

/**
 * A static page rather than anything interactive, because the question it answers is "do these
 * ramps look right", and that question is answered by looking. Dark ground throughout: judging a
 * light ramp against a light page hides exactly the step 1 and 2 separation that matters most.
 */
export function renderSwatchPage(groups, title = 'Cambium ramp swatches') {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title><style>${STYLE}</style></head>
<body><h1>${title}</h1>
<p class="note">Each cell shows its step, its OKLCH lightness, chroma and hue, and WCAG contrast
against its own ramp's step 2, then APCA Lc against the same background. WCAG is measured from the
same 8-bit hex colour the cell paints, not the full-precision value the engine solved for, so the
number describes what you're looking at. A red exclamation marks a color outside the sRGB gamut. A
dashed amber outline or "quantization-sensitive" label marks a step where that 8-bit rounding
changed the floor verdict from what full-precision math gives; a solid red outline marks a step
that misses its floor regardless. WCAG is the gate; the Lc figure is advisory and never decides a
pass.</p>
${groups.map(renderGroup).join('')}
</body></html>`;
}
