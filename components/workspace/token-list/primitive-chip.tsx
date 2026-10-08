import { useState } from 'react';

import { toOklchCss } from '../../../core/css/oklch-css';
import { CAMBIUM_NAMESPACE } from '../../../core/provenance';
import type { OverrideIssue, SchemeName, TokenOverride } from '../../../core/token-overrides';
import { overrideKey } from '../../../core/token-overrides';
import type { RampStep } from '../../../core/token-set';
import { NumberInput, useFieldIssues } from './number-input';
import { TokenEditor } from './token-editor';

const CHANNELS = ['l', 'c', 'h'] as const;

/**
 * One ramp step as a chip in `RampStrip`. `overrideKey` reads only `scheme`, `ramp` and `step`,
 * never `l`, `c` or `h`, so the three inputs share one key and a single reset clears all three at
 * once. The override replaces the whole triple whichever channel changed.
 *
 * The field issues live here, not in the popover, so a refused L stays announced after the popover
 * closes. The refused text itself doesn't survive: the inputs are uncontrolled and unmount with it.
 * The OKLCH text is `sr-only` on the chip because `keyed-path.spec.ts` and `seed-rail.spec.ts` read
 * a step's value off `[data-swatch-value]` inside its `[data-token]`. The editor prints the same
 * value visibly.
 */
export function PrimitiveChip({
	scheme,
	ramp,
	step,
	overrides,
	issuesFor,
	onOverride,
	onReset,
	tabIndex,
	onFocus,
	chipRef,
}: {
	scheme: SchemeName;
	ramp: string;
	step: RampStep;
	overrides: Record<string, TokenOverride>;
	issuesFor: (key: string) => OverrideIssue[];
	onOverride: (override: TokenOverride) => OverrideIssue[] | null;
	onReset: (key: string) => void;
	tabIndex: 0 | -1;
	onFocus: () => void;
	chipRef: (node: HTMLButtonElement | null) => void;
}) {
	const id = `primitive.${ramp}.${step.step}`;
	const key = overrideKey({
		kind: 'primitive',
		scheme,
		ramp,
		step: step.step,
		l: step.l,
		c: step.c,
		h: step.h,
	});
	const overridden = Object.hasOwn(overrides, key);
	const { fieldIssues, describedBy, settle, clear } = useFieldIssues();
	const heldIssues = issuesFor(key);
	const [resetGeneration, setResetGeneration] = useState(0);

	const withChannel = (channel: (typeof CHANNELS)[number], value: number): TokenOverride => ({
		kind: 'primitive',
		scheme,
		ramp,
		step: step.step,
		l: channel === 'l' ? value : step.l,
		c: channel === 'c' ? value : step.c,
		h: channel === 'h' ? value : step.h,
	});

	const swatch = toOklchCss({ l: step.l, c: step.c, h: step.h });

	return (
		<TokenEditor
			id={id}
			provenance={step.$extensions[CAMBIUM_NAMESPACE]}
			overridden={overridden}
			onReset={
				overridden
					? () => {
							clear();
							setResetGeneration((generation) => generation + 1);
							onReset(key);
						}
					: undefined
			}
			issues={[...heldIssues, ...fieldIssues]}
			trigger={{
				ref: chipRef,
				tabIndex,
				onFocus,
				title: id,
				'data-token': id,
				'data-overridden': overridden ? '' : undefined,
				className:
					'relative h-8 min-w-0 flex-1 rounded-sm border data-[overridden]:ring-2 data-[overridden]:ring-foreground',
				children: (
					<>
						<span
							aria-hidden
							data-swatch
							className="absolute inset-0 rounded-sm"
							style={{ backgroundColor: swatch }}
						/>
						<span data-swatch-value className="sr-only">
							{swatch}
						</span>
					</>
				),
			}}
		>
			<span data-editor-swatch-value className="w-full font-mono text-xs">
				{swatch}
			</span>
			{CHANNELS.map((channel) => (
				<label
					// Keyed on the committed value, not just the channel, so a change from outside the row
					// (a seed edit, a preset switch) remounts the input with the new value instead of an
					// uncontrolled `defaultValue` going stale under it. The reset generation covers what the
					// value can't: a refused edit never moved its channel's committed value, so without it a
					// reset would clear the issue and leave the refused text sitting in the field.
					key={`${channel}:${step[channel]}:${resetGeneration}`}
					className="flex items-center gap-1 text-xs"
				>
					{channel.toUpperCase()}
					<NumberInput
						label={`${id} ${channel}`}
						describedBy={describedBy(channel)}
						shown={step[channel]}
						onBlurOutcome={(outcome) =>
							settle(channel, outcome, (value) => onOverride(withChannel(channel, value)))
						}
					/>
				</label>
			))}
		</TokenEditor>
	);
}
