import { toStylesheet } from '../css/stylesheet';
import { serializeDtcg } from '../dtcg/serialize';
import type { TokenSet } from '../token-set';

/**
 * One file as the browser will hand it to a person: the bytes, the name Playwright's
 * `download.suggestedFilename()` has to match, and the type a `Blob` carries. `lib/download.ts`
 * takes exactly this shape, and `e2e/export.spec.ts` imports it too, to type the bytes it computes
 * independently as the oracle for what a download should have produced.
 */
export type ExportArtifact = { filename: string; mediaType: string; contents: string };

/**
 * The DTCG 2025.10 format spec, §4.1: a design-tokens file "SHOULD" declare
 * `application/design-tokens+json` as its media type over `application/json`, because a generic
 * JSON type gives a consumer no way to route the file to a DTCG parser instead of any other one.
 */
const DTCG_MEDIA_TYPE = 'application/design-tokens+json';

const ARTIFACT_SUFFIXES = ['light.tokens.json', 'dark.tokens.json', 'tokens.css'] as const;

/**
 * Hostname only, never the full URL: a brand's path or query string carries nothing a filename
 * needs, and passing either through unfiltered would let a URL like `?x=../../etc` reach a
 * filesystem's save dialog. `core/brand-record.ts` stores `brandUrl` exactly as typed, and its
 * docblock says a bare domain like `acme.com` is the point, not a mistake, because a URL parse
 * would refuse it. So when the typed text yields no hostname, a second parse runs with `https://`
 * prepended before falling back to no prefix. "No hostname" covers a throw (`acme.com`) and a parse
 * that succeeds empty: `acme.com:8080` reads as the custom scheme `acme.com:` with no host. A
 * trailing dot is a valid FQDN terminator someone might type or paste, not part of the name, so
 * it's stripped after the hostname is in hand.
 */
export function filenamePrefix(brandUrl: string | null): string {
	if (brandUrl === null) return '';

	const hostname = hostnameOf(brandUrl) || hostnameOf(`https://${brandUrl}`);
	const cleaned = hostname.replace(/\.+$/, '').replace(/[^a-z0-9.-]/g, '');

	return cleaned === '' ? '' : `${cleaned}-`;
}

function hostnameOf(text: string): string {
	try {
		return new URL(text).hostname.toLowerCase();
	} catch {
		return '';
	}
}

/**
 * The three filenames `exportArtifacts` builds, so a caller choosing which artifact to download
 * can match on a name instead of an array position that drifts silently if this file's order ever
 * changes.
 */
export function artifactFilenames(brandUrl: string | null): string[] {
	const prefix = filenamePrefix(brandUrl);

	return ARTIFACT_SUFFIXES.map((suffix) => `${prefix}${suffix}`);
}

/**
 * The three files issue #29 lets a person download, as bytes rather than the DTCG documents or
 * CSS string those bytes come from. Pure like the adapters it wraps: no DOM, no network, and
 * (per `serializeDtcg`'s own contract) no reference back into `tokenSet`, so a caller that mutates
 * one of these artifacts cannot reach the token set that produced it.
 *
 * `tokenSet` is whatever `withContrastRepairs` and the user's overrides already produced
 * (`app/state/workspace-store.ts`), so this function has no repair or override logic of its own to
 * get out of sync with theirs.
 *
 * Order is light, dark, stylesheet—the order the Export panel lists them. Filenames come from
 * `artifactFilenames`, so a caller matching an artifact by name reads the same list this function
 * builds from, rather than a second copy that can drift out of step with it.
 */
export function exportArtifacts(
	tokenSet: TokenSet,
	options: { brandUrl: string | null },
): ExportArtifact[] {
	const [lightFilename, darkFilename, cssFilename] = artifactFilenames(options.brandUrl) as [
		string,
		string,
		string,
	];
	const { light, dark } = serializeDtcg(tokenSet);

	return [
		{
			filename: lightFilename,
			mediaType: DTCG_MEDIA_TYPE,
			// A trailing newline, matching what a text editor leaves a hand-saved JSON file with, so a
			// download doesn't look truncated to whatever opens it next.
			contents: `${JSON.stringify(light, null, 2)}\n`,
		},
		{
			filename: darkFilename,
			mediaType: DTCG_MEDIA_TYPE,
			contents: `${JSON.stringify(dark, null, 2)}\n`,
		},
		{
			filename: cssFilename,
			mediaType: 'text/css',
			contents: toStylesheet(tokenSet),
		},
	];
}
