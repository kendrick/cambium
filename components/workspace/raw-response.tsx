/**
 * Collapsed by default because the raw response is evidence to check the seed against, not
 * something anyone reads first. A native `<details>` opens and closes without any script, so it
 * adds nothing to the bundle.
 */
export function RawResponse({ rawResponse }: { rawResponse: string | null }) {
	return (
		<details className="text-sm">
			<summary className="cursor-pointer font-medium">Raw model response</summary>
			{rawResponse === null ? (
				// Null is what `BrandVersionSchema` uses for a version no model call produced, such as a
				// preset re-derivation, so the absence is stated rather than shown as an empty box.
				<p className="text-muted-foreground mt-2">
					This version has no raw response. No model call produced it.
				</p>
			) : (
				// Capped and scrolling on its own only from md up. Below md the page scrolls it, and a long
				// unbroken run wraps rather than widening the page (#157).
				<pre className="bg-muted mt-2 rounded p-2 text-xs whitespace-pre-wrap max-md:wrap-anywhere md:max-h-64 md:overflow-auto">
					{rawResponse}
				</pre>
			)}
		</details>
	);
}
