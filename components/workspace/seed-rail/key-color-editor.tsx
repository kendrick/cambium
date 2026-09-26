import { toOklchCss } from '../../../core/css/oklch-css';
import { type KeyColor, KeyColorSchema } from '../../../core/brand-seed';
import { NumberInput, useFieldIssues } from '../token-list/number-input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

const ROLES = KeyColorSchema.shape.proposedRole.options;

/**
 * Chroma has no ceiling in the schema, but sRGB tops out near 0.32, so the range stops at 0.4 and
 * the number field takes anything larger for a wide-gamut colour.
 */
const CHANNELS = [
	{ index: 0, name: 'Lightness', min: 0, max: 1, step: 0.001, ceiling: 1 },
	{ index: 1, name: 'Chroma', min: 0, max: 0.4, step: 0.001, ceiling: Infinity },
	{ index: 2, name: 'Hue', min: 0, max: 360, step: 0.1, ceiling: 360 },
] as const;

export const swatchFor = ([l, c, h]: KeyColor['oklch']) => toOklchCss({ l, c, h }, { places: 4 });

/**
 * The swatch is the trigger, so the colour a person clicks is the colour they edit. Every channel
 * change goes straight to the draft, since re-deriving is cheap enough to run on each step of a
 * dragged range and the point is to watch the tokens move.
 */
export function KeyColorEditor({
	label,
	color,
	onChange,
}: {
	/** Sentence fragment naming the colour, e.g. "brand key colour". */
	label: string;
	color: KeyColor;
	onChange: (next: KeyColor) => void;
}) {
	const { fieldIssues, settle } = useFieldIssues();
	const withChannel = (index: 0 | 1 | 2, value: number): KeyColor => {
		const oklch: KeyColor['oklch'] = [...color.oklch];
		oklch[index] = value;
		return { ...color, oklch };
	};

	return (
		<Popover>
			<PopoverTrigger
				aria-label={`Edit ${label}`}
				className="focus-visible:ring-ring/50 size-7 shrink-0 rounded-md border shadow-xs outline-none focus-visible:ring-3"
				style={{ backgroundColor: swatchFor(color.oklch) }}
			/>
			<PopoverContent align="start" className="w-80">
				<div className="flex items-center gap-3">
					<span
						aria-hidden
						data-editor-swatch
						className="size-10 shrink-0 rounded-md border"
						style={{ backgroundColor: swatchFor(color.oklch) }}
					/>
					<div className="flex min-w-0 flex-col gap-0.5">
						<PopoverTitle className="first-letter:uppercase">{label}</PopoverTitle>
						<span className="text-muted-foreground truncate font-mono text-xs">
							{swatchFor(color.oklch)}
						</span>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					{CHANNELS.map((channel) => {
						const value = color.oklch[channel.index];

						return (
							<div
								key={channel.name}
								className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2"
							>
								<span className="text-muted-foreground text-xs">{channel.name}</span>
								<input
									type="range"
									aria-label={`${label} ${channel.name.toLowerCase()}`}
									min={channel.min}
									max={channel.max}
									step={channel.step}
									value={Math.min(value, channel.max)}
									onChange={(event) =>
										onChange(withChannel(channel.index, Number(event.target.value)))
									}
									className="accent-foreground w-full"
								/>
								<NumberInput
									// Keyed on the value so a drag on the range remounts the field with it.
									key={value}
									label={`${label} ${channel.name.toLowerCase()} value`}
									shown={value}
									onBlurOutcome={(outcome) =>
										settle(channel.name, outcome, (next) => {
											if (next < channel.min || next > channel.ceiling) {
												return [
													{
														path: [channel.name],
														message:
															channel.ceiling === Infinity
																? `${channel.name} can't be negative.`
																: `${channel.name} runs ${channel.min} to ${channel.ceiling}.`,
													},
												];
											}
											onChange(withChannel(channel.index, next));
											return null;
										})
									}
								/>
							</div>
						);
					})}
					{fieldIssues.length > 0 ? (
						<ul className="text-destructive text-xs">
							{fieldIssues.map((issue) => (
								<li key={issue.message}>{issue.message}</li>
							))}
						</ul>
					) : null}
				</div>

				<label className="flex items-center justify-between gap-2 text-xs">
					<span className="text-muted-foreground">Role</span>
					<select
						aria-label={`${label} role`}
						value={color.proposedRole}
						onChange={(event) =>
							onChange({ ...color, proposedRole: event.target.value as KeyColor['proposedRole'] })
						}
						className="bg-background rounded border px-1 py-0.5 text-xs"
					>
						{ROLES.map((role) => (
							<option key={role} value={role}>
								{role}
							</option>
						))}
					</select>
				</label>
			</PopoverContent>
		</Popover>
	);
}
