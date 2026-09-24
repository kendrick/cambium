import type { Interpretation } from '../../app/state/workspace-store';
import type { BrandSeed } from '../../core/brand-seed';

const PRESETS: readonly Interpretation[] = ['faithful', 'balanced', 'expressive'];

/** Key colors never reach this: they get a swatch, which a string cannot carry. */
function formatField(value: unknown): string {
	return value === null ? 'Not stated' : typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Read-only: seed editing is #25. The preset `<select>` is deliberately unstyled because #37
 * replaces it along with the presets' real parameters.
 */
export function SeedRail({
	seed,
	preset,
	onSelectPreset,
}: {
	seed: BrandSeed | null;
	preset: Interpretation;
	onSelectPreset: (preset: Interpretation) => void;
}) {
	const { keyColors, ...rest } = seed ?? { keyColors: null };

	return (
		<section aria-labelledby="seed-heading" className="flex flex-col gap-3">
			<h2 id="seed-heading" className="text-lg font-semibold">
				Seed
			</h2>

			<label className="flex flex-col gap-1 text-sm">
				Interpretation
				<select
					value={preset}
					onChange={(event) => onSelectPreset(event.target.value as Interpretation)}
				>
					{PRESETS.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			</label>

			{seed === null ? (
				<p className="text-muted-foreground text-sm">
					This record has no versions yet, so there is no seed to show.
				</p>
			) : (
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
					<dt className="text-muted-foreground">keyColors</dt>
					<dd>
						{keyColors === null ? (
							'Not stated'
						) : (
							<ul className="flex flex-col gap-1">
								{keyColors.map(({ oklch: [l, c, h], proposedRole }, index) => (
									<li key={index} className="flex items-center gap-2">
										<span
											aria-hidden
											className="inline-block size-4 rounded border"
											style={{ backgroundColor: `oklch(${l} ${c} ${h})` }}
										/>
										{proposedRole}: oklch({l} {c} {h})
									</li>
								))}
							</ul>
						)}
					</dd>
					{Object.entries(rest).map(([field, value]) => (
						<div key={field} className="contents">
							<dt className="text-muted-foreground">{field}</dt>
							<dd className="break-words">{formatField(value)}</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}
