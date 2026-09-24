import { toOklchCss } from '../../../core/css/oklch-css';
import { CAMBIUM_NAMESPACE } from '../../../core/provenance';
import type { OverrideIssue, SchemeName, TokenOverride } from '../../../core/token-overrides';
import { overrideKey } from '../../../core/token-overrides';
import type { RampStep } from '../../../core/token-set';
import { TokenRow } from './token-row';

const CHANNELS = ['l', 'c', 'h'] as const;

/**
 * One ramp step. `overrideKey` never reads `l`, `c` or `h`, only `scheme`, `ramp` and `step`, so the
 * three inputs share one key and a single reset clears all three at once — the override replaces
 * the whole triple regardless of which channel changed.
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
	issuesFor: (key: string) => OverrideIssue[] | undefined;
	onOverride: (override: TokenOverride) => void;
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
			onReset={overridden ? () => onReset(key) : undefined}
			issues={issuesFor(key)}
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
					<input
						type="number"
						step="any"
						aria-label={`${id} ${channel}`}
						defaultValue={step[channel]}
						onBlur={(event) => {
							const next = Number(event.target.value);
							if (Number.isFinite(next)) onOverride(withChannel(channel, next));
						}}
						className="w-20 rounded border px-1"
					/>
				</label>
			))}
		</TokenRow>
	);
}
