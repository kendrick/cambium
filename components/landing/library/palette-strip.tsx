import type { PaletteSwatch } from './palette';

export function PaletteStrip({ swatches }: { swatches: PaletteSwatch[] | null }) {
	if (!swatches) {
		return (
			<p className="text-muted-foreground text-xs" data-palette="none">
				Not generated yet
			</p>
		);
	}

	return (
		<ul
			aria-label="Palette"
			className="flex h-4 w-full max-w-56 overflow-hidden rounded-sm border"
			data-palette
		>
			{swatches.map(({ token, css }) => (
				<li
					className="h-full flex-1"
					data-swatch={token}
					key={token}
					style={{ backgroundColor: css }}
				>
					<span className="sr-only">{token}</span>
				</li>
			))}
		</ul>
	);
}
