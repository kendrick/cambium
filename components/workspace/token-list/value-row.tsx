import { CAMBIUM_NAMESPACE } from '../../../core/provenance';
import type {
	OverrideIssue,
	SchemeName,
	TokenOverride,
	ValueCategory,
	ValuePath,
} from '../../../core/token-overrides';
import { overrideKey } from '../../../core/token-overrides';
import { leafLabel } from './format';
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
	issuesFor: (key: string) => OverrideIssue[] | undefined;
	onOverride: (override: TokenOverride) => void;
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
	const issues = keys.flatMap((key) => issuesFor(key) ?? []);

	return (
		<TokenRow
			id={id}
			provenance={provenance}
			overridden={overridden}
			onReset={overridden ? () => keys.forEach((key) => onReset(key)) : undefined}
			issues={issues}
		>
			{token.leaves.map((leaf) => {
				const label = leafLabel(leaf.suffix);

				return (
					<label
						// See `primitive-row.tsx`: keying on the committed value remounts the input on a
						// reset or an outside override instead of leaving a stale `defaultValue` in place.
						key={`${leaf.suffix.join('.')}:${leaf.value}`}
						className="flex items-center gap-1 text-xs"
					>
						{label}
						<input
							type="number"
							step="any"
							aria-label={`${id} ${label}`}
							defaultValue={leaf.value}
							onBlur={(event) => {
								const next = Number(event.target.value);
								if (Number.isFinite(next)) onOverride(overrideFor(leaf.suffix, next));
							}}
							className="w-20 rounded border px-1"
						/>
						{leaf.unit ? <span className="text-muted-foreground">{leaf.unit}</span> : null}
					</label>
				);
			})}
		</TokenRow>
	);
}
