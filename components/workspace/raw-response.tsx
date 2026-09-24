/**
 * Collapsed by default because the raw response is evidence to check the seed against, not
 * something anyone reads first. A `<details>` rather than a disclosure component keeps it working
 * before hydration and costs nothing in the bundle.
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
				<pre className="bg-muted mt-2 max-h-64 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
					{rawResponse}
				</pre>
			)}
		</details>
	);
}
