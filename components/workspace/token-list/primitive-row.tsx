import { useState } from 'react';

import { toOklchCss } from '../../../core/css/oklch-css';
import { CAMBIUM_NAMESPACE } from '../../../core/provenance';
import type { OverrideIssue, SchemeName, TokenOverride } from '../../../core/token-overrides';
import { overrideKey } from '../../../core/token-overrides';
import type { RampStep } from '../../../core/token-set';
import { NumberInput, useFieldIssues } from './number-input';
import { TokenRow } from './token-row';

const CHANNELS = ['l', 'c', 'h'] as const;

/**
 * One ramp step. `overrideKey` reads only `scheme`, `ramp` and `step`, never `l`, `c` or `h`, so the
 * three inputs share one key and a single reset clears all three at once. The override replaces the
 * whole triple whichever channel changed.
 */
export function PrimitiveRow({
	scheme,
	ramp,
	step,
	overrides,
	issuesFor,
	onOverride,
	onReset,
}: {
	scheme: SchemeName;
	ramp: string;
	step: RampStep;
	overrides: Record<string, TokenOverride>;
	issuesFor: (key: string) => OverrideIssue[];
	onOverride: (override: TokenOverride) => OverrideIssue[] | null;
	onReset: (key: string) => void;
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
	const { fieldIssues, settle, clear } = useFieldIssues();
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

	return (
		<TokenRow
			id={id}
			provenance={step.$extensions[CAMBIUM_NAMESPACE]}
			swatch={toOklchCss({ l: step.l, c: step.c, h: step.h })}
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
		>
			{CHANNELS.map((channel) => (
				<label
					// Keyed on the committed value, not just the channel, so an override applied elsewhere
					// (a preset switch, another control) remounts the input with the new truth instead of an
					// uncontrolled `defaultValue` going stale under it. The reset generation covers what the
					// value can't: a refused edit never moved its channel's committed value, so without it a
					// reset would clear the issue and leave the refused text sitting in the field.
					key={`${channel}:${step[channel]}:${resetGeneration}`}
					className="flex items-center gap-1 text-xs"
				>
					{channel.toUpperCase()}
					<NumberInput
						label={`${id} ${channel}`}
						shown={step[channel]}
						onBlurOutcome={(outcome) =>
							settle(channel, outcome, (value) => onOverride(withChannel(channel, value)))
						}
					/>
				</label>
			))}
		</TokenRow>
	);
}
