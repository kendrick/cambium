import type { ReactNode } from 'react';

import {
	type BrandSeed,
	BrandSeedSchema,
	ExpressiveAxisSchema,
	type ExpressiveScore,
	type FontCandidate,
	type SuggestedPairing,
	TypeClassificationSchema,
} from '../../../core/brand-seed';
import { NumberInput, useFieldIssues } from '../token-list/number-input';

type Present<K extends keyof BrandSeed> = NonNullable<BrandSeed[K]>;

const RADIUS = BrandSeedSchema.shape.radiusCharacter.unwrap().shape;
const SHADOW = BrandSeedSchema.shape.shadowCharacter.unwrap().shape;
const TRACKING = BrandSeedSchema.shape.trackingFeel.unwrap().options;
const TYPE = TypeClassificationSchema.shape;
const SLOTS = ['display', 'body', 'mono'] as const satisfies readonly (keyof SuggestedPairing)[];

export const selectClass = 'bg-background min-w-0 rounded border px-1 py-0.5 text-xs';

/** One labelled control inside a field's cell. The label is visible text, so it names the control. */
export function Sub({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="flex items-center justify-between gap-2 text-xs">
			<span className="text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

export function EnumSelect<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: readonly T[];
	onChange: (next: T) => void;
}) {
	return (
		<select
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value as T)}
			className={selectClass}
		>
			{options.map((option) => (
				<option key={option} value={option}>
					{option}
				</option>
			))}
		</select>
	);
}

/**
 * The token list's number field, plus the seed's own bounds. `editSeed` doesn't parse, so a value
 * the schema refuses would sit in the draft until Save, then fail there with nothing pointing back
 * at this field.
 */
function BoundedNumber({
	label,
	value,
	min,
	max,
	exclusiveMin = false,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max?: number;
	exclusiveMin?: boolean;
	onChange: (next: number) => void;
}) {
	const { fieldIssues, settle } = useFieldIssues();
	const tooLow = (next: number) => (exclusiveMin ? next <= min : next < min);
	const bound =
		max === undefined
			? `${exclusiveMin ? 'above' : 'at least'} ${min}`
			: `between ${min} and ${max}`;

	return (
		<span className="flex flex-col items-end gap-0.5">
			<NumberInput
				key={value}
				label={label}
				shown={value}
				onBlurOutcome={(outcome) =>
					settle(label, outcome, (next) => {
						if (tooLow(next) || (max !== undefined && next > max)) {
							return [{ path: [label], message: `Enter a number ${bound}.` }];
						}
						onChange(next);
						return null;
					})
				}
			/>
			{fieldIssues.map((issue) => (
				<span key={issue.message} className="text-destructive text-xs">
					{issue.message}
				</span>
			))}
		</span>
	);
}

export function NeutralTemperatureEditor({
	value,
	onChange,
}: {
	value: Present<'neutralTemperature'>;
	onChange: (next: Present<'neutralTemperature'>) => void;
}) {
	return (
		<>
			<Sub label="Hue">
				<BoundedNumber
					label="Neutral temperature hue"
					value={value.hue}
					min={0}
					max={360}
					onChange={(hue) => onChange({ ...value, hue })}
				/>
			</Sub>
			<Sub label="Chroma">
				<BoundedNumber
					label="Neutral temperature chroma"
					value={value.chroma}
					min={0}
					onChange={(chroma) => onChange({ ...value, chroma })}
				/>
			</Sub>
		</>
	);
}

export function RadiusEditor({
	value,
	onChange,
}: {
	value: Present<'radiusCharacter'>;
	onChange: (next: Present<'radiusCharacter'>) => void;
}) {
	return (
		<>
			<Sub label="Base (px)">
				<BoundedNumber
					label="Radius base"
					value={value.base}
					min={0}
					onChange={(base) => onChange({ ...value, base })}
				/>
			</Sub>
			<Sub label="Progression">
				<EnumSelect
					label="Radius progression"
					value={value.progression}
					options={RADIUS.progression.options}
					onChange={(progression) => onChange({ ...value, progression })}
				/>
			</Sub>
		</>
	);
}

export function ShadowEditor({
	value,
	onChange,
}: {
	value: Present<'shadowCharacter'>;
	onChange: (next: Present<'shadowCharacter'>) => void;
}) {
	return (
		<>
			<Sub label="Spread">
				<EnumSelect
					label="Shadow spread"
					value={value.spread}
					options={SHADOW.spread.options}
					onChange={(spread) => onChange({ ...value, spread })}
				/>
			</Sub>
			<Sub label="Tint from surface">
				<input
					type="checkbox"
					checked={value.tintFromSurface}
					onChange={(event) => onChange({ ...value, tintFromSurface: event.target.checked })}
					className="accent-foreground"
				/>
			</Sub>
		</>
	);
}

export function TrackingEditor({
	value,
	onChange,
}: {
	value: Present<'trackingFeel'>;
	onChange: (next: Present<'trackingFeel'>) => void;
}) {
	return (
		<Sub label="Feel">
			<EnumSelect label="Tracking" value={value} options={TRACKING} onChange={onChange} />
		</Sub>
	);
}

export function TypeClassificationEditor({
	value,
	onChange,
}: {
	value: Present<'typeClassification'>;
	onChange: (next: Present<'typeClassification'>) => void;
}) {
	return (
		<>
			<Sub label="Category">
				<EnumSelect
					label="Type category"
					value={value.category}
					options={TYPE.category.options}
					onChange={(category) => onChange({ ...value, category })}
				/>
			</Sub>
			<Sub label="Tone">
				<EnumSelect
					label="Type tone"
					value={value.tone}
					options={TYPE.tone.options}
					onChange={(tone) => onChange({ ...value, tone })}
				/>
			</Sub>
			<Sub label="x-height">
				<EnumSelect
					label="Type x-height"
					value={value.xHeight}
					options={TYPE.xHeight.options}
					onChange={(xHeight) => onChange({ ...value, xHeight })}
				/>
			</Sub>
			<Sub label="Display differs from body">
				<input
					type="checkbox"
					checked={value.displayDiffersFromBody}
					onChange={(event) => onChange({ ...value, displayDiffersFromBody: event.target.checked })}
					className="accent-foreground"
				/>
			</Sub>
		</>
	);
}

/**
 * Where the font ranking follows the model, it takes each slot's first candidate
 * (`core/rank-fonts.ts`), so a choice has to land first. Option values are indices because two
 * candidates can share a family name.
 */
export function PairingEditor({
	value,
	onChange,
}: {
	value: Present<'suggestedPairing'>;
	onChange: (next: Present<'suggestedPairing'>) => void;
}) {
	return (
		<>
			{SLOTS.map((slot) => {
				const candidates = value[slot];
				// `.every` is vacuously true on an empty slot, so this also covers the slot that has never
				// had a derived candidate. Either way there's no ranked option to fall back to, so the text
				// path has to stay open rather than handing the field to a select with one entry and no way
				// off it.
				const handPick = candidates.find(isHandPick);
				const onlyHandPicked = candidates.every(isHandPick);

				return (
					<Sub key={slot} label={capitalise(slot)}>
						{onlyHandPicked ? (
							<FamilyInput
								// Remounts on a changed family so the uncontrolled input's initial value tracks a
								// correction, a save-and-reload, or a Discard back to the active version.
								key={handPick?.family ?? ''}
								label={`${capitalise(slot)} font`}
								defaultValue={handPick?.family}
								onName={(family) => onChange({ ...value, [slot]: [namedByHand(family)] })}
							/>
						) : (
							<select
								aria-label={`${capitalise(slot)} font`}
								value={0}
								onChange={(event) =>
									onChange({ ...value, [slot]: pickFirst(candidates, Number(event.target.value)) })
								}
								className={`${selectClass} max-w-40`}
							>
								{candidates.map((candidate, index) => (
									<option key={index} value={index}>
										{candidate.family}
										{isHandPick(candidate)
											? ' (your pick)'
											: candidate.score === null
												? ''
												: ` (${candidate.score})`}
									</option>
								))}
							</select>
						)}
					</Sub>
				);
			})}
		</>
	);
}

/**
 * `invented` because nothing ranked it: the schema reserves `derived` for a candidate the tag lookup
 * scored, and a family a person typed or picked has no score of its own.
 */
function namedByHand(family: string): FontCandidate {
	return { provenance: 'invented', family, score: null, rationale: HAND_PICK_RATIONALE };
}

const HAND_PICK_RATIONALE = 'Chosen by hand in the workspace.';

function isHandPick(candidate: FontCandidate): boolean {
	return candidate.provenance === 'invented' && candidate.rationale === HAND_PICK_RATIONALE;
}

/**
 * Commits on blur or Enter, like the number fields, so a half-typed name never reaches the draft.
 * `defaultValue` is read once at mount, uncontrolled from then on: the caller forces a remount by
 * keying on the family it's meant to show whenever that value changes underneath it.
 */
function FamilyInput({
	label,
	defaultValue,
	onName,
}: {
	label: string;
	defaultValue?: string;
	onName: (family: string) => void;
}) {
	const settle = (raw: string) => {
		const family = raw.trim();
		if (family !== '') onName(family);
	};

	return (
		<input
			type="text"
			aria-label={label}
			placeholder="Name a family"
			defaultValue={defaultValue}
			onBlur={(event) => settle(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === 'Enter') settle(event.currentTarget.value);
			}}
			className="bg-background w-32 rounded border px-1 py-0.5 text-xs"
		/>
	);
}

/**
 * The choice goes first as an `invented` copy rather than moving the scored candidate itself.
 * `rankedByScore` holds derived candidates to descending score, so a lower-scored one moved ahead of
 * a higher one fails the parse on Save, while an unscored pick sits outside that ordering and the
 * model's ranking stays intact behind it.
 *
 * An earlier hand pick, and any invented entry of the same family, drops out, so choosing again
 * replaces the pick instead of stacking copies.
 */
function pickFirst(candidates: readonly FontCandidate[], index: number): FontCandidate[] {
	const chosen = candidates[index];

	if (!chosen) return [...candidates];

	const rest = candidates.filter(
		(candidate) =>
			!isHandPick(candidate) &&
			!(candidate.provenance === 'invented' && candidate.family === chosen.family),
	);

	return [namedByHand(chosen.family), ...rest];
}

export function TypeScaleRatioEditor({
	value,
	onChange,
}: {
	value: number;
	onChange: (next: number) => void;
}) {
	return (
		<Sub label="Step to step">
			<BoundedNumber
				label="Type scale ratio"
				value={value}
				min={0}
				exclusiveMin
				onChange={onChange}
			/>
		</Sub>
	);
}

/**
 * The schema wants the list ranked highest first, and `put` parses it on Save, so each change
 * re-sorts. Rows are keyed by axis, so the one being dragged keeps focus when it moves.
 */
export function ExpressiveEditor({
	value,
	onChange,
}: {
	value: Present<'expressive'>;
	onChange: (next: Present<'expressive'>) => void;
}) {
	const unscored = ExpressiveAxisSchema.options.filter(
		(axis) => !value.some((entry) => entry.axis === axis),
	);
	const withScore = (axis: ExpressiveScore['axis'], score: number): ExpressiveScore[] =>
		ranked(value.map((entry) => (entry.axis === axis ? { ...entry, score } : entry)));

	return (
		<>
			{value.map((entry) => (
				<label
					key={entry.axis}
					className="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs"
				>
					<span className="text-muted-foreground">{entry.axis}</span>
					<input
						type="range"
						aria-label={`${entry.axis} score`}
						min={0}
						max={100}
						step={1}
						value={entry.score}
						onChange={(event) => onChange(withScore(entry.axis, Number(event.target.value)))}
						className="accent-foreground w-full"
					/>
					<span className="text-right font-mono tabular-nums">{entry.score}</span>
				</label>
			))}
			{value.length === 0 ? (
				<span className="text-muted-foreground text-xs">No axes scored</span>
			) : null}
			{unscored.length > 0 ? (
				// Resets to the placeholder after every pick, since the chosen axis leaves the list.
				<select
					aria-label="Add an expressive axis"
					value=""
					onChange={(event) => {
						const axis = ExpressiveAxisSchema.parse(event.target.value);
						onChange(ranked([...value, { axis, score: 50 }]));
					}}
					className={`${selectClass} self-start`}
				>
					<option value="" disabled>
						Add an axis…
					</option>
					{unscored.map((axis) => (
						<option key={axis} value={axis}>
							{axis}
						</option>
					))}
				</select>
			) : null}
		</>
	);
}

/** Takes a fresh array and sorts it in place, highest score first. */
function ranked(entries: ExpressiveScore[]): ExpressiveScore[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return entries.sort((a, b) => b.score - a.score);
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
