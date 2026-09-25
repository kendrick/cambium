import { useState } from 'react';

import { CAMBIUM_NAMESPACE } from '../../../core/provenance';
import type {
	OverrideIssue,
	SchemeName,
	TokenOverride,
	ValueCategory,
	ValuePath,
} from '../../../core/token-overrides';
import { toOklchCss } from '../../../core/css/oklch-css';
import { overrideKey } from '../../../core/token-overrides';
import { leafLabel } from './format';
import { NumberInput, useFieldIssues } from './number-input';
import { TokenRow } from './token-row';
import type { CategoryToken } from './walk-category';

/**
 * One token from a non-colour category, which may carry several independently overridable leaves
 * (a shadow's eight numbers, an easing curve's four) under one shared `$extensions`. Overridden and
 * issues are the union across every leaf's own key, so the row marks itself the moment any one of
 * its numbers has an edit on it, and the reset clears them all together.
 */
export function ValueRow({
	category,
	scheme,
	token,
	overrides,
	issuesFor,
	onOverride,
	onReset,
}: {
	category: ValueCategory | 'shadow';
	scheme: SchemeName;
	token: CategoryToken;
	overrides: Record<string, TokenOverride>;
	issuesFor: (key: string) => OverrideIssue[];
	onOverride: (override: TokenOverride) => OverrideIssue[] | null;
	onReset: (key: string) => void;
}) {
	const id = `${category}.${token.path.join('.')}`;
	const provenance = token.extensions[CAMBIUM_NAMESPACE];

	const overrideFor = (suffix: ValuePath, value: number): TokenOverride =>
		category === 'shadow'
			? { kind: 'value', category: 'shadow', scheme, path: [...token.path, ...suffix], value }
			: { kind: 'value', category, path: [...token.path, ...suffix], value };

	const keys = token.leaves.map((leaf) => overrideKey(overrideFor(leaf.suffix, leaf.value)));
	const overridden = keys.some((key) => Object.hasOwn(overrides, key));
	const { fieldIssues, settle, clear } = useFieldIssues();
	const issues = [...keys.flatMap((key) => issuesFor(key)), ...fieldIssues];
	const swatch = shadowSwatch(token);
	const [resetGeneration, setResetGeneration] = useState(0);

	return (
		<TokenRow
			id={id}
			provenance={provenance}
			swatch={swatch}
			overridden={overridden}
			onReset={
				overridden
					? () => {
							clear();
							setResetGeneration((generation) => generation + 1);
							keys.forEach((key) => onReset(key));
						}
					: undefined
			}
			issues={issues}
		>
			{token.leaves.map((leaf) => {
				const label = leafLabel(leaf.suffix);

				return (
					<label
						// See `primitive-row.tsx`: the committed value remounts the input on an outside
						// change, and the reset generation remounts a refused one whose value never moved.
						key={`${leaf.suffix.join('.')}:${leaf.value}:${resetGeneration}`}
						className="flex items-center gap-1 text-xs"
					>
						{label}
						<NumberInput
							label={`${id} ${label}`}
							shown={leaf.value}
							onBlurOutcome={(outcome) =>
								settle(label, outcome, (value) => onOverride(overrideFor(leaf.suffix, value)))
							}
						/>
						{leaf.unit ? <span className="text-muted-foreground">{leaf.unit}</span> : null}
					</label>
				);
			})}
		</TokenRow>
	);
}

/**
 * A shadow is the one token outside the colour groups that carries a colour, in the four `color`
 * leaves the walker already collected. Reading the swatch off those leaves ties it to the numbers
 * the inputs show, so an override on `color.alpha` repaints it too.
 */
function shadowSwatch(token: CategoryToken): string | undefined {
	const channel = (name: string) =>
		token.leaves.find(
			(leaf) => leaf.suffix.length === 2 && leaf.suffix[0] === 'color' && leaf.suffix[1] === name,
		)?.value;
	const [l, c, h, alpha] = ['l', 'c', 'h', 'alpha'].map(channel);

	if (l === undefined || c === undefined || h === undefined) return undefined;

	return toOklchCss({ l, c, h, alpha });
}
