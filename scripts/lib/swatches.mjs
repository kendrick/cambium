import { contrastAPCA } from 'chroma-js';
import { formatHex } from 'culori/fn';

// ADR-0003 puts culori mode registration in one module and keeps it there. Importing the core's
// colour module for its side effect is what makes this harness measure through the same registered
// set the engine uses, rather than a second set that could drift out of step with it.
import { contrastFromOklch, isInSrgb, readOklch } from '../../core/oklch.ts';

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
 */
function measureStep(step, color, background, stepRole) {
	const oklch = readOklch(color);
	const wcag = contrastFromOklch(oklch, readOklch(background));

	return {
		step,
		hex: formatHex(color),
		l: oklch.l,
		c: oklch.c,
		h: oklch.h,
		wcag,
		apca: apcaOf(color, background),
		inSrgb: isInSrgb(oklch),
		role: stepRole?.role ?? null,
		failsContrast: stepRole?.minWcagVsStep2 != null && wcag < stepRole.minWcagVsStep2,
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

const cellText = (step) => (step.wcag >= 4.5 ? '#ffffff' : '#111111');

function renderCell(step) {
	const l = step.l.toFixed(3);
	const c = step.c.toFixed(3);
	const gamut = step.inSrgb ? '' : ' <span class="warn">!</span>';
	const fail = step.failsContrast ? ' <span class="warn">fails floor</span>' : '';
	const cellClass = step.failsContrast ? 'cell fail' : 'cell';

	return `<div class="${cellClass}" style="background:${step.hex};color:${cellText(step)}">
		<b>${step.step}</b>
		${step.role ? `<span class="role">${step.role}</span>` : ''}
		<span>${l} / ${c}</span>
		<span>${step.wcag.toFixed(2)}:1${gamut}${fail}</span>
		<span>Lc ${Math.round(step.apca)}</span>
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
	.cell.fail { outline:2px solid #ff5c5c; outline-offset:-2px; }
	.warn { color:#ff5c5c; font-weight:700; }
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
<p class="note">Each cell shows its step, OKLCH lightness and chroma, and WCAG contrast against
its own ramp's step 2, then APCA Lc against the same background. A red exclamation marks a color
outside the sRGB gamut. WCAG is the gate; the Lc figure is advisory and never decides a pass.</p>
${groups.map(renderGroup).join('')}
</body></html>`;
}
