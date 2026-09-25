import type { SchemeName } from '../token-overrides';
import type { TokenSet } from '../token-set';
import {
	type CssDeclaration,
	type CssNaming,
	checkTokenSet,
	requireDistinctProperties,
	scalarDeclarationList,
	schemeDeclarationList,
} from './globals-css';

/**
 * One scheme's colour, shadow and ramp declarations, keyed by property: what `toGlobalsCss` writes
 * under `:root` (light, before the scalars) or `.dark`.
 *
 * A record rather than a stylesheet because the preview sets these as inline custom properties on
 * its own container, where no `.dark` class can switch them. Both read one builder in
 * `globals-css.ts`, so the preview and the exported file can't disagree on a name or a value.
 *
 * The set goes through the same checks the stylesheet makes, so a set the export would refuse
 * doesn't render in the preview as if it were fine.
 */
export function schemeDeclarations(
	tokenSet: TokenSet,
	scheme: SchemeName,
	naming: CssNaming,
): Record<string, string> {
	const declarations = schemeDeclarationList(checkTokenSet(tokenSet), scheme, naming);

	return declarationMap(`the ${scheme} scheme`, declarations);
}

/**
 * Radius, typography and tracking, keyed by property. Separate from {@link schemeDeclarations}
 * because the stylesheet declares these under `:root` only and lets `.dark` inherit them, while a
 * preview container scoped to one scheme has nothing to inherit from and needs them either way.
 */
export function scalarDeclarations(tokenSet: TokenSet, naming: CssNaming): Record<string, string> {
	const declarations = scalarDeclarationList(checkTokenSet(tokenSet).tokenSet, naming);

	return declarationMap('the scalars', declarations);
}

function declarationMap(
	label: string,
	declarations: readonly CssDeclaration[],
): Record<string, string> {
	requireDistinctProperties(label, declarations);

	return Object.fromEntries(declarations.map(({ property, value }) => [property, value]));
}
