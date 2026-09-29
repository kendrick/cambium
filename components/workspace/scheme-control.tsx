import { SCHEME_NAMES } from '../../core/scale-engine';
import type { SchemeName } from '../../core/token-overrides';

const LABELS: Record<SchemeName, string> = { light: 'Light', dark: 'Dark' };

/**
 * The workspace's one scheme, for the token list and the preview together. Before #154 each held
 * its own, so the list could describe dark while the preview showed light, and an alias edit
 * landed in whichever scheme the list was on. Not persisted: the issue rules that out, and
 * ADR-0004 treats the scheme as a toggle the workspace owns, not a stored field.
 *
 * `aria-pressed` buttons rather than a radio group: two Tab stops and no roving focus to build for
 * two options. Plain buttons rather than `components/ui/button`: the chrome's focus outline (#152)
 * already reaches them, and `Button` would add its own `border-ring` on focus on top of it.
 */
export function SchemeControl({
	scheme,
	onSchemeChange,
}: {
	scheme: SchemeName;
	onSchemeChange: (scheme: SchemeName) => void;
}) {
	return (
		<fieldset className="m-0 inline-flex gap-0.5 rounded-md border p-0.5">
			<legend className="sr-only">Colour scheme</legend>
			{SCHEME_NAMES.map((option) => (
				<button
					key={option}
					type="button"
					aria-pressed={scheme === option}
					onClick={() => onSchemeChange(option)}
					className="aria-pressed:bg-muted rounded-sm px-3 py-1 text-sm aria-pressed:font-semibold"
				>
					{LABELS[option]}
				</button>
			))}
		</fieldset>
	);
}
