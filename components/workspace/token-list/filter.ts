/**
 * Whether a token id (`semantic.border`, `primitive.brand.9`, `radius.md`) survives the list's
 * name filter. Case-insensitive because semantic names are kebab-case while `focusRing` and
 * `zIndex` are camel-cased, and a person typing "ring" means both.
 */
export function matchesFilter(id: string, query: string): boolean {
	const needle = query.trim().toLowerCase();

	return needle === '' || id.toLowerCase().includes(needle);
}
