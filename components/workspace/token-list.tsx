import type { ScaleEngineResult } from '../../core/scale-engine';

/**
 * Plain on purpose: #26 replaces these contents. Until then the list only has to show that a
 * re-derive happened, so it prints each scheme's ramps as name and value and nothing more.
 */
export function TokenList({ derived }: { derived: ScaleEngineResult | null }) {
	if (derived === null) {
		return <p className="text-muted-foreground text-sm">No seed yet, so there are no tokens.</p>;
	}

	if (!derived.ok) {
		return (
			<p className="text-sm">
				These tokens could not be derived: <code>{derived.error.kind}</code>
				{derived.error.kind === 'unreachable-floor'
					? ` (${derived.error.ramp} step ${derived.error.step})`
					: null}
				.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{Object.entries(derived.schemes).map(([scheme, ramps]) => (
				<section key={scheme} className="flex flex-col gap-2">
					<h3 className="text-sm font-medium">{scheme}</h3>
					{Object.entries(ramps).map(([ramp, steps]) => (
						<ul key={ramp} className="flex flex-col font-mono text-xs">
							{steps.map(({ step, l, c, h }) => (
								<li key={step}>
									{ramp}.{step}: oklch({l} {c} {h})
								</li>
							))}
						</ul>
					))}
				</section>
			))}
		</div>
	);
}
