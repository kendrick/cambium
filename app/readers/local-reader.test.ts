import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReferenceImage } from '../../core/brand-record';
import { BrandSeedSchema } from '../../core/brand-seed';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import { parseSeed } from '../../core/parse-seed';
import { CAMBIUM_NAMESPACE, type TokenProvenance } from '../../core/provenance';
import { rankFonts } from '../../core/rank-fonts';
import { BALANCED } from '../../core/scale-engine';
import { buildTokenSet } from '../../core/semantic-layer';
import type { TokenExtensions } from '../../core/token-set';

import { LOGO_FIXTURE, NEUTRAL_PAGE_FIXTURE, SCREENSHOT_FIXTURE } from './fixtures/brand-images';
import {
	createLocalBrandReader,
	LOCAL_EXTRACT_VERSION,
	LOCAL_EXTRACTOR_MODEL,
	LOCAL_PROVIDER,
} from './local-reader';

const FIXTURES = [LOGO_FIXTURE, SCREENSHOT_FIXTURE, NEUTRAL_PAGE_FIXTURE];

/** The stored shape of a reference image. The data URL is never decoded here; see the reader. */
function storedImage(id: string): ReferenceImage {
	return { id, downscaled: `data:image/webp;base64,AA`, originalHash: `sha256:${id}` };
}

/**
 * Decoding a data URL needs `createImageBitmap` and a canvas, and Vitest runs in Node with
 * neither. `docs/agents/testing.md` leaves that untested on purpose, so the decoder is swapped for
 * the fixture pixels and what remains under test is the envelope and the seed inside it.
 */
function reader() {
	return createLocalBrandReader({
		async decode(image) {
			const fixture = FIXTURES.find((candidate) => candidate.id === image.id);

			if (!fixture) throw new Error(`no fixture for image "${image.id}"`);

			return fixture.sample;
		},
	});
}

describe('the local reader', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads with no credential and no network request', async () => {
		// `fetch` is a live global under Node, so its absence cannot be asserted the way
		// `document`'s can. Stubbing it to throw is what turns a stray call into a failure. Same
		// move `core/purity.test.ts` makes, for the same reason.
		vi.stubGlobal('fetch', () => {
			throw new Error('a local read must not reach the network');
		});

		const response = await reader().read([storedImage(LOGO_FIXTURE.id)], { auth: null });

		expect(parseSeed(response).seed?.keyColors).not.toBeNull();
	});

	/**
	 * `provider`, `model`, and `promptVersion` are what make a stored version reproducible, and no
	 * model answered this read. The fields name the two quantizers that did and the version of the
	 * heuristic that weighed them.
	 */
	it('stamps the envelope with what actually answered', async () => {
		const response = await reader().read([storedImage(SCREENSHOT_FIXTURE.id)], { auth: null });

		expect(response).toMatchObject({
			provider: LOCAL_PROVIDER,
			model: LOCAL_EXTRACTOR_MODEL,
			promptVersion: LOCAL_EXTRACT_VERSION,
		});
		expect(typeof response.raw).toBe('string');
	});

	/**
	 * An absent auth provider is first-class on this seam rather than degraded, and a present one
	 * buys a local read nothing. Refusing it would be a rule with no purpose behind it.
	 */
	it('ignores an auth provider it has no use for', async () => {
		const withAuth = await reader().read([storedImage(LOGO_FIXTURE.id)], {
			auth: { scheme: 'api-key' },
		});
		const without = await reader().read([storedImage(LOGO_FIXTURE.id)], { auth: null });

		expect(withAuth.raw).toBe(without.raw);
	});

	it('returns a partial seed the core accepts', async () => {
		const response = await reader().read(
			[storedImage(LOGO_FIXTURE.id), storedImage(SCREENSHOT_FIXTURE.id)],
			{ auth: null },
		);
		const result = parseSeed(response);

		expect(result.error).toBeUndefined();
		expect(result.seed?.keyColors?.map((color) => color.proposedRole)).toEqual(['brand', 'accent']);
	});

	it('returns a seed with no colours when the images hold none', async () => {
		const result = parseSeed(
			await reader().read([storedImage(NEUTRAL_PAGE_FIXTURE.id)], { auth: null }),
		);

		expect(result.seed?.keyColors).toBeNull();
	});
});

/**
 * The ticket's claim is that everything downstream is unchanged and that the gap between a keyless
 * read and a keyed one shows up as provenance rather than as a failure. That is a claim about the
 * core, so it is checked against the core rather than assumed.
 */
describe('what derivation does with a locally extracted seed', () => {
	async function localSeed() {
		const result = parseSeed(await reader().read([storedImage(LOGO_FIXTURE.id)], { auth: null }));

		if (!result.ok) throw new Error('a local read has to produce a parseable seed');

		return result.seed;
	}

	/**
	 * Asserts only that the engine accepts a colours-only seed, never how well it ramps one. Ramp
	 * quality and anchor deviation belong to Seam 1 against fixture seeds in `core/`, per
	 * `docs/agents/testing.md`, and duplicating them here would break this suite for engine
	 * changes that have nothing to do with the reader.
	 */
	it('produces a seed the scale engine can generate from', async () => {
		const generated = createOklchScaleEngine().generate(await localSeed(), BALANCED);

		expect(generated.error).toBeUndefined();
	});

	/**
	 * Font ranking is the one place `invented` provenance exists today, and it is reached through
	 * `typeClassification`, which colour cannot inform. So a local seed declines the whole stage
	 * rather than producing invented candidates: nothing is marked invented because nothing was
	 * invented.
	 *
	 * Token-level `$extensions` provenance is a separate mechanism and lands below, against every
	 * field this seed leaves null.
	 */
	it('declines to rank fonts rather than inventing a classification', async () => {
		const ranked = rankFonts(
			[{ family: 'Geo Sans', tag: '/Sans/Geometric', score: 100 }],
			await localSeed(),
		);

		expect(ranked).toEqual({ ok: false, error: { kind: 'no-type-classification' } });
	});

	it('leaves every field colour cannot inform null', async () => {
		const seed = await localSeed();
		const uninformed = Object.keys(BrandSeedSchema.shape).filter((key) => key !== 'keyColors');
		const read = (key: string) => seed[key as keyof typeof seed];

		// Compared as one object rather than asserted per field, so a failure names which field
		// came back populated instead of stopping at the first.
		expect(Object.fromEntries(uninformed.map((key) => [key, read(key)]))).toEqual(
			Object.fromEntries(uninformed.map((key) => [key, null])),
		);
	});

	/**
	 * The criterion #33 carried and could not satisfy, moved here by the comment on #9. Ten of the
	 * eleven seed fields come back null from a keyless read, so most of what a token set derives
	 * from one is invented rather than observed, and that share is much larger than the keyed path
	 * produces. Showing the gap is the point.
	 *
	 * Asserted over every token rather than a sample, because a sample would pass against a
	 * pipeline that marked one category honestly and guessed at the rest. `seedField` is the trace,
	 * so "not traceable to `keyColors`" is exactly "names some other field, or none".
	 *
	 * Runs here rather than in `core/` because the seed has to be one the extractor actually
	 * produced. A hand-written colours-only seed would assert the rule against a fixture that
	 * agrees with it by construction.
	 */
	it('marks every token a key colour cannot reach as invented', async () => {
		const seed = await localSeed();
		const generated = createOklchScaleEngine().generate(seed, BALANCED);

		if (!generated.ok) throw new Error('a local seed has to ramp');

		const found = payloads(buildTokenSet(generated.schemes, seed));
		const untraceable = found.filter(({ payload }) => payload.seedField !== 'keyColors');

		// Named by path rather than counted, so a failure says which token lied about where it came
		// from instead of only that some token did.
		expect(
			untraceable
				.filter(({ payload }) => payload.provenance !== 'invented')
				.map(({ path }) => path),
		).toEqual([]);

		// Both halves have to be non-empty or the assertion above passes vacuously: a set with no
		// payloads at all, and one where every token claimed `keyColors`, would each satisfy it.
		expect(untraceable.length).toBeGreaterThan(0);
		expect(found.length).toBeGreaterThan(untraceable.length);
	});
});

/**
 * Every provenance payload in a token set, with the path that carries it.
 *
 * Walks the parsed structure rather than reading a list the core exports, so a category that
 * forgot to tag itself shows up as a missing path rather than staying invisible to a helper that
 * only knows the categories somebody told it about.
 */
function payloads(node: unknown, path = ''): Array<{ path: string; payload: TokenProvenance }> {
	if (Array.isArray(node)) return node.flatMap((child, i) => payloads(child, `${path}[${i}]`));
	if (node === null || typeof node !== 'object') return [];

	const record = node as Record<string, unknown>;
	const extensions = record.$extensions as TokenExtensions | undefined;
	const own = extensions ? [{ path, payload: extensions[CAMBIUM_NAMESPACE] }] : [];

	return own.concat(
		Object.entries(record)
			.filter(([key]) => key !== '$extensions')
			.flatMap(([key, value]) => payloads(value, path ? `${path}.${key}` : key)),
	);
}
