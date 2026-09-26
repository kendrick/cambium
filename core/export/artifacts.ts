import { toStylesheet } from '../css/stylesheet';
import { serializeDtcg } from '../dtcg/serialize';
import type { TokenSet } from '../token-set';

/**
 * One file as the browser will hand it to a person: the bytes, the name Playwright's
 * `download.suggestedFilename()` has to match, and the type a `Blob` carries. `lib/download.ts`
 * (issue #29's next lane) is the only consumer, and it takes exactly this shape so the download
 * helper never has to know a DTCG document from a stylesheet.
 */
export type ExportArtifact = { filename: string; mediaType: string; contents: string };

/**
 * The DTCG 2025.10 format spec, §4.1: a design-tokens file "SHOULD" declare
 * `application/design-tokens+json` as its media type over `application/json`, because a generic
 * JSON type gives a consumer no way to route the file to a DTCG parser instead of any other one.
 */
const DTCG_MEDIA_TYPE = 'application/design-tokens+json';

/**
 * Hostname only, never the full URL: a brand's path or query string carries nothing a filename
 * needs, and passing either through unfiltered would let a URL like `?x=../../etc` reach a
 * filesystem's save dialog. `new URL()` throws on the seed's placeholder brand URLs and on
 * anything a person mistypes, and both cases fall back to no prefix rather than a half-built one.
 */
export function filenamePrefix(brandUrl: string | null): string {
	if (brandUrl === null) return '';

	let hostname: string;

	try {
		hostname = new URL(brandUrl).hostname.toLowerCase();
	} catch {
		return '';
	}

	const cleaned = hostname.replace(/[^a-z0-9.-]/g, '');

	return cleaned === '' ? '' : `${cleaned}-`;
}

/**
 * The three files issue #29 lets a person download, as bytes rather than the DTCG documents or
 * CSS string those bytes come from. Pure like the adapters it wraps: no DOM, no network, and
 * (per `serializeDtcg`'s own contract) no reference back into `tokenSet`, so a caller that mutates
 * one of these artifacts cannot reach the token set that produced it.
 *
 * `tokenSet` is whatever `withContrastRepairs` and the user's overrides already produced
 * (`app/state/workspace-store.ts`), so this function has no repair or override logic of its own to
 * get out of sync with theirs. It only ever asks two adapters what the current set looks like.
 *
 * Order is light, dark, stylesheet — the order the Export panel lists them and the order
 * `e2e/export.spec.ts` clicks through.
 */
export function exportArtifacts(
	tokenSet: TokenSet,
	options: { brandUrl: string | null },
): ExportArtifact[] {
	const prefix = filenamePrefix(options.brandUrl);
	const { light, dark } = serializeDtcg(tokenSet);

	return [
		{
			filename: `${prefix}light.tokens.json`,
			mediaType: DTCG_MEDIA_TYPE,
			// A trailing newline, matching what a text editor leaves a hand-saved JSON file with, so a
			// download doesn't look truncated to whatever opens it next.
			contents: `${JSON.stringify(light, null, 2)}\n`,
		},
		{
			filename: `${prefix}dark.tokens.json`,
			mediaType: DTCG_MEDIA_TYPE,
			contents: `${JSON.stringify(dark, null, 2)}\n`,
		},
		{
			filename: `${prefix}tokens.css`,
			mediaType: 'text/css',
			contents: toStylesheet(tokenSet),
		},
	];
}
