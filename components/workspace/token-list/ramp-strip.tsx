import { useRef, useState } from 'react';

import type { OverrideIssue, SchemeName, TokenOverride } from '../../../core/token-overrides';
import type { RampStep } from '../../../core/token-set';
import { PrimitiveChip } from './primitive-chip';
import { nextRovingIndex } from './roving';

/**
 * A ramp's steps as one toolbar with a roving tabindex, so the ramp costs one Tab stop instead of
 * one per control per step. Tab enters on the chip whose step last had focus, arrows move within,
 * and Enter falls through to the chip's own button, which opens its editor.
 *
 * `steps` arrives already filtered, so the active chip is tracked by its step number rather than
 * its index into `steps`: a filter change re-slices the array, and an index that survived the
 * re-slice would now name whatever chip happens to sit there instead of the one last focused.
 * `current` falls back to the first rendered chip once the remembered step is filtered out.
 */
export function RampStrip({
	ramp,
	scheme,
	steps,
	overrides,
	issuesFor,
	onOverride,
	onReset,
}: {
	ramp: string;
	scheme: SchemeName;
	steps: RampStep[];
	overrides: Record<string, TokenOverride>;
	issuesFor: (key: string) => OverrideIssue[];
	onOverride: (override: TokenOverride) => OverrideIssue[] | null;
	onReset: (key: string) => void;
}) {
	const [activeStep, setActiveStep] = useState<number | null>(null);
	const chips = useRef<(HTMLButtonElement | null)[]>([]);
	const current = Math.max(
		steps.findIndex((step) => step.step === activeStep),
		0,
	);

	return (
		// The rule wants the toolbar itself focusable, but the roving pattern keeps focus on one chip
		// at a time. A focusable container would cost a second stop or catch clicks in the gaps.
		// oxlint-disable-next-line jsx-a11y/interactive-supports-focus
		<div
			role="toolbar"
			aria-label={`${ramp} ramp`}
			data-ramp={ramp}
			className="flex gap-1 py-1"
			onKeyDown={(event) => {
				// React bubbles a portalled popover's key events up this tree, so an arrow typed in a
				// chip's L field lands here too. Only a key pressed on a chip is the strip's.
				if (!chips.current.includes(event.target as HTMLButtonElement)) return;

				const next = nextRovingIndex(current, event.key, steps.length);
				if (next === null) return;

				event.preventDefault();
				setActiveStep(steps[next]!.step);
				chips.current[next]?.focus();
			}}
		>
			{steps.map((step, index) => (
				<PrimitiveChip
					// Keyed by scheme too, so a toggle remounts the chip: a refused edit belongs to the
					// scheme it was typed in, and the other scheme's step never saw it.
					key={`${scheme}:${step.step}`}
					scheme={scheme}
					ramp={ramp}
					step={step}
					overrides={overrides}
					issuesFor={issuesFor}
					onOverride={onOverride}
					onReset={onReset}
					tabIndex={index === current ? 0 : -1}
					onFocus={() => setActiveStep(step.step)}
					chipRef={(node) => {
						chips.current[index] = node;
					}}
				/>
			))}
		</div>
	);
}
