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
							onReset(key);
						}
					: undefined
			}
			issues={[...heldIssues, ...fieldIssues]}
		>
			{CHANNELS.map((channel) => (
				<label
					// Keyed on the committed value, not just the channel, so a reset or an override applied
					// elsewhere (a preset switch, another control) remounts the input with the new truth
					// instead of an uncontrolled `defaultValue` going stale under it.
					key={`${channel}:${step[channel]}`}
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
