import { type ReactNode, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import {
	canonicalPins,
	type CommitProvenance,
	type Interpretation,
	sameJson,
	samePins,
	type WorkspaceState,
} from '../../app/state/workspace-store';
import type { BrandRecord, BrandVersion } from '../../core/brand-record';
import type { BrandSeed, KeyColor } from '../../core/brand-seed';
import type { SeedPinPath } from '../../core/seed-pins';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	ExpressiveEditor,
	NeutralTemperatureEditor,
	PairingEditor,
	RadiusEditor,
	ShadowEditor,
	TrackingEditor,
	TypeClassificationEditor,
	TypeScaleRatioEditor,
} from '@/components/workspace/seed-rail/field-editors';
import {
	ImageClassificationsEditor,
	TagDisagreements,
} from '@/components/workspace/seed-rail/image-tags';
import { KeyColorEditor, swatchFor } from '@/components/workspace/seed-rail/key-color-editor';
import { PinToggle } from '@/components/workspace/seed-rail/pin-toggle';
import { SourceRegion } from '@/components/workspace/seed-rail/source-region';

const PRESETS: readonly Interpretation[] = ['faithful', 'balanced', 'expressive'];

type Field = Exclude<keyof BrandSeed, 'keyColors'>;

/** Display names, also the pin toggle's "Pin …" text once lowercased. */
const FIELD_LABELS: Record<Field, string> = {
	neutralTemperature: 'Neutral temperature',
	radiusCharacter: 'Radius',
	shadowCharacter: 'Shadow',
	trackingFeel: 'Tracking',
	typeClassification: 'Type classification',
	suggestedPairing: 'Font pairing',
	typeScaleRatio: 'Type scale ratio',
	imageClassifications: 'Image classifications',
	expressive: 'Expressive',
};

const FIELDS = Object.keys(FIELD_LABELS) as Field[];

/**
 * A person made this version, not a model, so it names the workspace rather than carrying the
 * model's provider and prompt forward (the store refuses that for an edited seed anyway). `fontTable`
 * does carry: it names the table fonts rank against, which an edit doesn't change.
 */
const HAND_EDITED = 'hand-edited';

function handEditedProvenance(active: BrandVersion): CommitProvenance {
	return {
		provider: 'cambium-workspace',
		model: HAND_EDITED,
		promptVersion: HAND_EDITED,
		rawResponse: null,
		fontTable: active.fontTable,
	};
}

/**
 * What "Set" writes into a field the model left null. Where the engine falls back to a fixed value
 * for null, the default is that value, so setting the field changes nothing until the person moves
 * it: a 10px soft radius (`core/radius-scale.ts`) and a 1.2 ratio (`core/type-scale.ts`). The
 * neutral has no fixed fallback, since the engine tints it off the brand by a preset parameter, so
 * it starts as a grey at the first key colour's hue that a person can warm from there.
 */
function defaultFor(field: Field, seed: BrandSeed, record: BrandRecord): BrandSeed[Field] {
	switch (field) {
		case 'neutralTemperature':
			return { hue: seed.keyColors?.[0]?.oklch[2] ?? 0, chroma: 0 };
		case 'radiusCharacter':
			return { base: 10, progression: 'soft' };
		case 'shadowCharacter':
			return { spread: 'tight', tintFromSurface: false };
		case 'trackingFeel':
			return 'normal';
		case 'typeClassification':
			return {
				category: 'sans',
				tone: 'grotesque',
				xHeight: 'medium',
				displayDiffersFromBody: false,
			};
		case 'suggestedPairing':
			return { display: [], body: [], mono: [] };
		case 'typeScaleRatio':
			return 1.2;
		case 'imageClassifications':
			// A person's own tag is the better first guess than an arbitrary option, where they gave one.
			return record.images.map((image) => ({
				imageId: image.id,
				detected: image.tag === 'auto' ? 'photo' : image.tag,
			}));
		case 'expressive':
			return [];
	}
}

/**
 * Two key colours can share a role, and "Pin brand key colour" twice would give a screen reader two
 * identical buttons. Only a repeated role gets a number.
 */
function keyColorLabels(keyColors: readonly KeyColor[]): string[] {
	const seen = new Map<string, number>();

	return keyColors.map(({ proposedRole }) => {
		const count = keyColors.filter((color) => color.proposedRole === proposedRole).length;
		const nth = (seen.get(proposedRole) ?? 0) + 1;
		seen.set(proposedRole, nth);

		return count > 1 ? `${proposedRole} key colour ${nth}` : `${proposedRole} key colour`;
	});
}

export function SeedRail({ store }: { store: StoreApi<WorkspaceState> }) {
	const record = useStore(store, (state) => state.record);
	const activeOrdinal = useStore(store, (state) => state.activeOrdinal);
	const seed = useStore(store, (state) => state.draftSeed);
	const preset = useStore(store, (state) => state.preset);
	const pins = useStore(store, (state) => state.draftPins);
	const overrides = useStore(store, (state) => state.overrides);
	const editSeed = useStore(store, (state) => state.editSeed);
	const togglePin = useStore(store, (state) => state.togglePin);
	const selectPreset = useStore(store, (state) => state.selectPreset);
	const commit = useStore(store, (state) => state.commit);
	const discardEdits = useStore(store, (state) => state.discardEdits);

	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const active =
		record && activeOrdinal !== null ? (record.versions[activeOrdinal - 1] ?? null) : null;
	const seedEdited = active !== null && !sameJson(seed, active.seed);
	// `draftPins` is already canonical; `active.pins` need not be, so it goes through the same
	// canonicalise-then-compare the store's own commit guard uses. Sharing the function rather than
	// each side re-deriving its own answer is what keeps this decision and the store's `sameSeed`
	// commit guard from ever disagreeing about whether a pin change is real.
	const pinsEdited = active !== null && !samePins(canonicalPins(active.pins), pins);
	const dirty =
		seedEdited ||
		pinsEdited ||
		(active !== null &&
			(preset !== active.interpretation || !sameJson(Object.values(overrides), active.overrides)));
	const pinned = (path: SeedPinPath) => pins.includes(path);

	async function save() {
		if (!active) return;

		setSaving(true);
		setSaveError(null);

		try {
			await commit(seedEdited ? handEditedProvenance(active) : undefined);
		} catch (error) {
			// Navigating away mid-save abandons the commit on purpose, and there's nothing to report.
			if (!(error instanceof Error && 'kind' in error && error.kind === 'commit-abandoned')) {
				setSaveError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			setSaving(false);
		}
	}

	return (
		<section aria-labelledby="seed-heading" className="flex min-h-0 flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<h2 id="seed-heading" className="text-lg font-semibold">
					Seed
				</h2>
				{active ? (
					<div className="flex items-center gap-2">
						{dirty ? <span className="text-muted-foreground text-xs">Unsaved edits</span> : null}
						<Button
							variant="outline"
							size="sm"
							disabled={!dirty || saving}
							onClick={() => {
								setSaveError(null);
								discardEdits();
							}}
						>
							Discard
						</Button>
						<Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
							{saving ? 'Saving…' : 'Save'}
						</Button>
					</div>
				) : null}
			</div>

			{saveError ? (
				<Alert variant="destructive">
					<AlertTitle>The seed was not saved</AlertTitle>
					<AlertDescription>{saveError}</AlertDescription>
				</Alert>
			) : null}

			<label className="flex items-center justify-between gap-2 text-sm">
				Interpretation
				<select
					value={preset}
					onChange={(event) => selectPreset(event.target.value as Interpretation)}
					className="bg-background rounded border px-1 py-0.5 text-sm"
				>
					{PRESETS.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			</label>

			{seed === null || record === null ? (
				<p className="text-muted-foreground text-sm">
					This record has no versions yet, so there is no seed to show.
				</p>
			) : (
				<ul className="min-h-0 overflow-y-auto rounded border px-2">
					<KeyColorRows
						record={record}
						keyColors={seed.keyColors}
						activeKeyColors={active?.seed?.keyColors ?? null}
						pinned={pinned}
						onToggle={togglePin}
						onChange={(keyColors) => editSeed({ keyColors })}
					/>
					{FIELDS.map((field) => {
						const label = FIELD_LABELS[field];

						return (
							<FieldRow
								key={field}
								field={field}
								label={label}
								pin={
									<PinToggle
										label={label.toLowerCase()}
										pinned={pinned(field)}
										onToggle={() => togglePin(field)}
									/>
								}
							>
								{seed[field] === null ? (
									<NotRead
										label={label.toLowerCase()}
										onSet={() => editSeed({ [field]: defaultFor(field, seed, record) })}
									/>
								) : (
									<FieldEditor field={field} seed={seed} record={record} editSeed={editSeed} />
								)}
								{field === 'imageClassifications' ? (
									<TagDisagreements
										images={record.images}
										classifications={seed.imageClassifications}
										activeClassifications={active?.seed?.imageClassifications ?? null}
										handEdited={active?.model === HAND_EDITED}
									/>
								) : null}
							</FieldRow>
						);
					})}
				</ul>
			)}
		</section>
	);
}

/**
 * The pin sits in its own trailing column on every row, key colours included, so a person scanning
 * for what's protected reads one straight line.
 */
function FieldRow({
	field,
	label,
	pin,
	children,
}: {
	field: string;
	label: ReactNode;
	pin: ReactNode;
	children: ReactNode;
}) {
	return (
		<li
			data-seed-field={field}
			className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-2 border-b py-2 last:border-b-0"
		>
			<span className="pt-1 text-xs font-medium">{label}</span>
			<div className="flex min-w-0 flex-col gap-1.5">{children}</div>
			{pin}
		</li>
	);
}

function NotRead({ label, onSet }: { label: string; onSet: () => void }) {
	return (
		<div className="flex items-center justify-between gap-2 pt-1 text-xs">
			<span className="text-muted-foreground italic">Not read from the images</span>
			<Button variant="outline" size="xs" onClick={onSet} aria-label={`Set ${label}`}>
				Set
			</Button>
		</div>
	);
}

function FieldEditor({
	field,
	seed,
	record,
	editSeed,
}: {
	field: Field;
	seed: BrandSeed;
	record: BrandRecord;
	editSeed: (patch: Partial<BrandSeed>) => void;
}) {
	switch (field) {
		case 'neutralTemperature':
			return seed.neutralTemperature ? (
				<NeutralTemperatureEditor
					value={seed.neutralTemperature}
					onChange={(neutralTemperature) => editSeed({ neutralTemperature })}
				/>
			) : null;
		case 'radiusCharacter':
			return seed.radiusCharacter ? (
				<RadiusEditor
					value={seed.radiusCharacter}
					onChange={(radiusCharacter) => editSeed({ radiusCharacter })}
				/>
			) : null;
		case 'shadowCharacter':
			return seed.shadowCharacter ? (
				<ShadowEditor
					value={seed.shadowCharacter}
					onChange={(shadowCharacter) => editSeed({ shadowCharacter })}
				/>
			) : null;
		case 'trackingFeel':
			return seed.trackingFeel ? (
				<TrackingEditor
					value={seed.trackingFeel}
					onChange={(trackingFeel) => editSeed({ trackingFeel })}
				/>
			) : null;
		case 'typeClassification':
			return seed.typeClassification ? (
				<TypeClassificationEditor
					value={seed.typeClassification}
					onChange={(typeClassification) => editSeed({ typeClassification })}
				/>
			) : null;
		case 'suggestedPairing':
			return seed.suggestedPairing ? (
				<PairingEditor
					value={seed.suggestedPairing}
					onChange={(suggestedPairing) => editSeed({ suggestedPairing })}
				/>
			) : null;
		case 'typeScaleRatio':
			return seed.typeScaleRatio === null ? null : (
				<TypeScaleRatioEditor
					value={seed.typeScaleRatio}
					onChange={(typeScaleRatio) => editSeed({ typeScaleRatio })}
				/>
			);
		case 'imageClassifications':
			return seed.imageClassifications ? (
				<ImageClassificationsEditor
					images={record.images}
					value={seed.imageClassifications}
					onChange={(imageClassifications) => editSeed({ imageClassifications })}
				/>
			) : null;
		case 'expressive':
			return seed.expressive ? (
				<ExpressiveEditor
					value={seed.expressive}
					onChange={(expressive) => editSeed({ expressive })}
				/>
			) : null;
	}
}

/**
 * One row per colour rather than one for the field, because each pins on its own. No "Set" for a
 * missing list: a key colour has to name the image it was read from, and one made up here would
 * claim an observation nobody made.
 */
function KeyColorRows({
	record,
	keyColors,
	activeKeyColors,
	pinned,
	onToggle,
	onChange,
}: {
	record: BrandRecord;
	keyColors: KeyColor[] | null;
	activeKeyColors: KeyColor[] | null;
	pinned: (path: SeedPinPath) => boolean;
	onToggle: (path: SeedPinPath) => void;
	onChange: (next: KeyColor[]) => void;
}) {
	if (keyColors === null || keyColors.length === 0) {
		return (
			<FieldRow field="keyColors" label="Key colours" pin={<span className="size-7" />}>
				<span className="text-muted-foreground pt-1 text-xs italic">Not read from the images</span>
			</FieldRow>
		);
	}

	const labels = keyColorLabels(keyColors);

	return (
		<>
			{keyColors.map((color, index) => {
				const label = labels[index]!;
				const path = `keyColors.${index}` as const;
				const original = activeKeyColors?.[index];
				const edited = original !== undefined && !sameJson(color, original);

				return (
					<FieldRow
						key={index}
						field={path}
						label={index === 0 ? 'Key colours' : ''}
						pin={<PinToggle label={label} pinned={pinned(path)} onToggle={() => onToggle(path)} />}
					>
						<div className="flex items-center gap-2">
							<KeyColorEditor
								label={label}
								color={color}
								onChange={(next) =>
									onChange(keyColors.map((other, i) => (i === index ? next : other)))
								}
							/>
							<div className="flex min-w-0 flex-col">
								<span className="flex items-center gap-1.5 text-xs">
									<span className="font-medium">{color.proposedRole}</span>
									{edited ? (
										<span
											data-edited
											className="bg-muted text-muted-foreground rounded px-1 text-[0.6875rem]"
										>
											edited
										</span>
									) : null}
								</span>
								<span className="text-muted-foreground truncate font-mono text-[0.6875rem]">
									{swatchFor(color.oklch)}
								</span>
							</div>
						</div>
						<SourceRegion
							label={label}
							image={record.images.find((image) => image.id === color.sourceImageId)}
							region={color.sourceRegion}
						/>
					</FieldRow>
				);
			})}
		</>
	);
}
