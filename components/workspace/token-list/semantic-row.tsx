import { CAMBIUM_NAMESPACE } from '../../../core/provenance';
import { STEP_ROLES } from '../../../core/step-roles';
import type { OverrideIssue } from '../../../core/token-overrides';
import type { SemanticEntry } from '../../../core/token-set';
import type { Swatch } from './format';
import { TokenRow } from './token-row';

/**
 * One semantic token. Its only control is the alias `<select>`, which `TokenRow` mounts inside the
 * edit popover. Commits and refusals stay with `TokenList`, which holds refused alias attempts by
 * override key (see `aliasAttempts` there). The AA verdict (#153) renders on the row, not in the
 * popover, so `contrastFailures` passes straight through to `TokenRow`.
 */
export function SemanticRow({
	token,
	entry,
	swatch,
	rampOptions,
	overridden,
	issues,
	contrastFailures,
	onAliasChange,
	onReset,
}: {
	token: string;
	entry: SemanticEntry;
	/** The resolved colour, painted on the row's swatch at full precision and printed beside it at three decimals. */
	swatch: Swatch;
	/** Every `ramp.step` in the current scheme, in ramp order. */
	rampOptions: readonly string[];
	overridden: boolean;
	issues: OverrideIssue[];
	/** Always a list, empty until this row's override breaks a pair, so the live region is mounted. */
	contrastFailures: { label: string; wcag: number; target: number }[];
	onAliasChange: (alias: string) => void;
	onReset?: () => void;
}) {
	const step = Number(entry.alias.slice(entry.alias.lastIndexOf('.') + 1));
	const role = STEP_ROLES.find((candidate) => candidate.step === step)?.role;

	return (
		<TokenRow
			id={`semantic.${token}`}
			provenance={entry.$extensions[CAMBIUM_NAMESPACE]}
			resolvesTo={entry.alias}
			stepRole={role}
			swatch={swatch}
			overridden={overridden}
			onReset={onReset}
			issues={issues}
			contrastFailures={contrastFailures}
			revertLabel={`${token} override`}
		>
			<AliasSelect
				token={token}
				value={entry.alias}
				options={rampOptions}
				onChange={onAliasChange}
			/>
		</TokenRow>
	);
}

function AliasSelect({
	token,
	value,
	options,
	onChange,
}: {
	token: string;
	value: string;
	options: readonly string[];
	onChange: (alias: string) => void;
}) {
	return (
		<select
			aria-label={`${token} alias`}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			{options.map((option) => (
				<option key={option} value={option}>
					{option}
				</option>
			))}
		</select>
	);
}
