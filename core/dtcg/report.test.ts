import { describe, expect, it } from 'vitest';

import { SPEC_LIGHT_DOCUMENT } from './dtcg.fixture';
import { summarizeViolations } from './report';
import { type DtcgViolation, validateDtcg } from './validate';

/**
 * RFC 6901 §4 resolution, the same walk `validator.test.ts` does. Copied rather than shared
 * because a helper exported from a test file drags that file's whole suite into this one's run,
 * and ten lines of pointer arithmetic is the cheaper duplicate.
 */
function resolvePointer(tokenDocument: unknown, pointer: string): unknown {
	if (pointer === '') return tokenDocument;

	return pointer
		.slice(1)
		.split('/')
		.map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
		.reduce<unknown>(
			(node, token) => (node as Record<string, unknown> | undefined)?.[token],
			tokenDocument,
		);
}

/**
 * The independent ruler for every case below. A break is stated as a pointer and a value, so the
 * test knows where the damage is without ever consulting the summarizer's grouping rule. Grading
 * the grouping against the grouping would prove only that it agrees with itself.
 *
 * Deep-cloned first: the fixtures are module-level constants shared with whatever else imports
 * them, and a test that edited one in place would hand the next test a document broken somewhere
 * it never asked for.
 */
function breakAt(tokenDocument: unknown, pointer: string, value: unknown): unknown {
	const damaged = structuredClone(tokenDocument);
	const segments = pointer
		.slice(1)
		.split('/')
		.map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
	const last = segments.pop();

	if (last === undefined) throw new Error('breakAt needs a pointer with at least one segment');

	const parent = segments.reduce<Record<string, unknown>>(
		(node, token) => node[token] as Record<string, unknown>,
		damaged as Record<string, unknown>,
	);

	parent[last] = value;

	return damaged;
}

function violationsOf(tokenDocument: unknown): DtcgViolation[] {
	const result = validateDtcg(tokenDocument);

	if (result.valid) throw new Error('expected this document to fail validation');

	return result.violations;
}

const oklchToken = (components: number[], extra: Record<string, unknown> = {}) => ({
	$type: 'color',
	$value: { colorSpace: 'oklch', components, ...extra },
});

const badHue = {
	color: { brand: oklchToken([0.62, 0.19, 360]) },
};

/** Passes `validateDtcg` as written, so every case below fails only where the test broke it. */
const validColour = { color: { brand: oklchToken([0.62, 0.19, 259.8]) } };

/**
 * Resolves each row's pointer against the document, which is how every case here names what the
 * summary found without restating the summary's own grouping rule.
 */
function summarizedValues(tokenDocument: unknown): unknown[] {
	return summarizeViolations(violationsOf(tokenDocument)).map((summary) =>
		resolvePointer(tokenDocument, summary.pointer),
	);
}

describe('summarizeViolations', () => {
	/**
	 * The case #52 deferred and #11 settled. Nineteen diagnostics across six pointers, one of which
	 * is about the hue and the rest of which describe branches the author never chose. The count is
	 * read from `validateDtcg` rather than typed in, so this measures the collapse ratio against
	 * whatever the schema produces today.
	 */
	it('collapses the bad-hue diagnostics into a single row addressing the hue', () => {
		const violations = violationsOf(badHue);
		const [summary, ...rest] = summarizeViolations(violations);

		expect(rest).toEqual([]);
		expect(resolvePointer(badHue, summary?.pointer ?? '')).toBe(360);
		expect(summary?.likelyCause).toBe('must be < 360');
		expect(summary?.collapsed).toBe(violations.length);
	});

	/**
	 * Each document is broken in exactly one place the test chose, and the only thing asserted is
	 * that walking the row's pointer lands on the value that was planted. The planted values are
	 * distinctive, so resolving to one is not something a wrong pointer does by luck.
	 *
	 * The set spans the keyword shapes the schema fails on, because the ranking inside a row has to
	 * survive all of them: a numeric bound, a string pattern, an enum, an array length, and an
	 * alias whose syntax is malformed. The schema resolves no alias targets, so a syntactically
	 * valid alias pointing nowhere would not fail here at all.
	 */
	const singleBreaks: [name: string, document: unknown, pointer: string, planted: unknown][] = [
		['an OKLCH hue at the top of the range', badHue, '/color/brand/$value/components/2', 360],
		[
			'an eight-digit hex fallback',
			{ color: { brand: oklchToken([0.62, 0.19, 259.8], { hex: '#000000' }) } },
			'/color/brand/$value/hex',
			'#aabbccdd',
		],
		[
			'a colour space the schema does not know',
			{ color: { brand: oklchToken([0.62, 0.19, 259.8]) } },
			'/color/brand/$value/colorSpace',
			'oklab2',
		],
		[
			'a dimension carrying a unit outside the enum',
			{ radius: { md: { $type: 'dimension', $value: { value: 0.625, unit: 'rem' } } } },
			'/radius/md/$value/unit',
			'em',
		],
		[
			'a font weight past the top of the scale',
			{ typography: { weight: { bold: { $type: 'fontWeight', $value: 700 } } } },
			'/typography/weight/bold/$value',
			1200,
		],
		[
			'a cubic bezier missing a control point',
			{ motion: { easing: { out: { $type: 'cubicBezier', $value: [0.2, 0, 0.4, 1] } } } },
			'/motion/easing/out/$value',
			[0.2, 0, 0.4],
		],
		[
			'an alias missing its closing brace',
			{ color: { brand: { $type: 'color', $value: '{color.primitive.brand.1}' } } },
			'/color/brand/$value',
			'{color.primitive.brand.1',
		],
		[
			'a hex fallback inside the spec fixture',
			SPEC_LIGHT_DOCUMENT,
			'/color/primitive/brand/1/$value/hex',
			'#aabbccdd',
		],
		[
			'a property the schema forbids inside a colour value',
			validColour,
			'/color/brand/$value/foo',
			'illegal',
		],
		['a property the schema forbids on a group', validColour, '/color/zzz', 'illegal'],
		['a property the schema forbids on a token', validColour, '/color/brand/zzz', 'illegal'],
	];

	it.each(singleBreaks)('points at %s', (_name, tokenDocument, pointer, planted) => {
		const damaged = breakAt(tokenDocument, pointer, planted);
		const [summary, ...rest] = summarizeViolations(violationsOf(damaged));

		expect(rest).toEqual([]);
		expect(resolvePointer(damaged, summary?.pointer ?? '')).toEqual(planted);
	});

	/**
	 * The guard on the risk #52 named. Collapsing is only safe while two independent mistakes stay
	 * two rows. The moment they merge, the summary has hidden a real problem behind a plausible one,
	 * which is what stopped `validateDtcg` from pruning in the first place.
	 *
	 * The two breaks sit in different top-level groups, so every diagnostic they share is one
	 * reported at an ancestor of both.
	 */
	it('keeps two independent breaks in two rows', () => {
		const damaged = breakAt(
			breakAt(SPEC_LIGHT_DOCUMENT, '/color/primitive/brand/1/$value/components/2', 360),
			'/radius/md/$value/unit',
			'em',
		);

		expect(new Set(summarizedValues(damaged))).toEqual(new Set([360, 'em']));
	});

	/**
	 * An illegal property sitting beside a deeper invalid field is the case that broke an earlier
	 * version of this function, and it is the one the whole design has to survive. Ajv reports the
	 * illegal key against the object that holds it, so once `validate.ts` joins the key on, the
	 * complaint looks like an ancestor of the hue failure and gets absorbed into it. The document
	 * has two independent problems and the summary said one.
	 *
	 * Silently losing a true violation is the failure #52 refused, so it is worse here than the
	 * noise #52 was willing to keep. Both values have to be named.
	 */
	it('names an illegal property beside a deeper invalid field', () => {
		const damaged = breakAt(
			breakAt(validColour, '/color/brand/$value/components/2', 360),
			'/color/brand/$value/foo',
			'illegal',
		);

		expect(new Set(summarizedValues(damaged))).toEqual(new Set([360, 'illegal']));
	});

	/**
	 * The property a summary has to have if a caller is going to work through a document with it:
	 * fix what a row names, validate again, and whatever is left is still named. A summary that
	 * absorbs one problem into another passes the first round and strands the caller on the second,
	 * because the document stays invalid for something no row ever mentioned.
	 */
	it('still names the illegal property once the hue it sat beside is fixed', () => {
		const damaged = breakAt(
			breakAt(validColour, '/color/brand/$value/components/2', 360),
			'/color/brand/$value/foo',
			'illegal',
		);

		const hueRow = summarizeViolations(violationsOf(damaged)).find(
			(summary) => resolvePointer(damaged, summary.pointer) === 360,
		);
		const repaired = breakAt(damaged, hueRow?.pointer ?? '', 259.8);

		expect(summarizedValues(repaired)).toEqual(['illegal']);
	});

	/**
	 * Two illegal properties on one object share every ancestor they have, so nothing but the keys
	 * themselves tells them apart.
	 */
	it('gives each illegal property on one value its own row', () => {
		const damaged = breakAt(
			breakAt(validColour, '/color/brand/$value/foo', 'first'),
			'/color/brand/$value/bar',
			'second',
		);

		expect(new Set(summarizedValues(damaged))).toEqual(new Set(['first', 'second']));
	});

	/**
	 * An illegal key at the root folds to the empty pointer, which is an ancestor of every other
	 * diagnostic in the document. Absorbing it there would hide it behind whichever token happens
	 * to be broken as well.
	 */
	it('keeps a stray root property out of a broken token elsewhere in the document', () => {
		const damaged = breakAt(
			breakAt(badHue, '/$foo', 'stray'),
			'/color/brand/$value/components/2',
			360,
		);

		expect(new Set(summarizedValues(damaged))).toEqual(new Set([360, 'stray']));
	});

	/**
	 * The illegal key is the only thing the value contains, so the object it sits in also fails for
	 * the properties it is missing. The key still has to be named rather than absorbed into those.
	 */
	it('names an illegal property that is all the value contains', () => {
		const damaged = breakAt(validColour, '/color/brand/$value', { foo: 'illegal' });

		expect(summarizedValues(damaged)).toContain('illegal');
	});

	/**
	 * A summary is lossy by construction, and `collapsed` is the only thing telling a reader
	 * whether one row stands for one mistake or forty. It is worth nothing unless the rows
	 * partition the input, so this asserts the arithmetic rather than the wording: every diagnostic
	 * counted once, by exactly one row.
	 */
	it('accounts for every diagnostic exactly once', () => {
		for (const [, tokenDocument, pointer, planted] of singleBreaks) {
			const violations = violationsOf(breakAt(tokenDocument, pointer, planted));
			const counted = summarizeViolations(violations).reduce(
				(total, summary) => total + summary.collapsed,
				0,
			);

			expect(counted).toBe(violations.length);
		}
	});

	/**
	 * A summarizer that reworded a diagnostic would be inventing a claim the schema never made, and
	 * a plausible invented message is worse than a confusing real one because nobody thinks to
	 * check it against the schema.
	 */
	it('quotes messages verbatim and never invents one', () => {
		const violations = violationsOf(badHue);
		const produced = new Set(violations.map((violation) => violation.message));

		for (const summary of summarizeViolations(violations)) {
			for (const message of [summary.likelyCause, ...summary.alternatives]) {
				expect(produced).toContain(message);
			}
		}
	});

	it('summarizes nothing as no rows', () => {
		expect(summarizeViolations([])).toEqual([]);
	});

	/**
	 * Pure core: the same list summarizes the same way twice, and the caller's array comes back
	 * untouched. The second half matters because `validateDtcg`'s violations are the raw list the
	 * validation UI in #23 still has to render after the summary has been taken.
	 */
	it('is deterministic and leaves its argument alone', () => {
		const violations = violationsOf(badHue);
		const untouched = structuredClone(violations);

		expect(summarizeViolations(violations)).toEqual(summarizeViolations(violations));
		expect(violations).toEqual(untouched);
	});
});
