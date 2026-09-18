'use client';

import { type ChangeEvent, useId, useRef, useState } from 'react';

import {
	chooseGuidance,
	DEFAULT_IMAGE_TAG,
	type GuidanceKey,
	IMAGE_TAGS,
	type ImageTag,
	MAX_REFERENCE_IMAGES,
	MIN_REFERENCE_IMAGES,
} from '@/components/landing/image-set';
import { Button } from '@/components/ui/button';
import { type PreparedImage, prepareReferenceImage } from '@/lib/image-intake';

import type { BrandRecord } from '../../core/brand-record';

/**
 * A picked image as the form holds it: what was stored, what the person called it, and the tag they
 * applied.
 *
 * `tag` lives here and nowhere else. `ReferenceImageSchema` is a `z.strictObject` holding an id, a
 * downscaled data URL, and a hash of the original, with no slot for a tag, so a tag drives the
 * guidance below and then dies with the page.
 *
 * Storing it beside the record rather than in it was considered and rejected. `app/storage/` could
 * hold a second object store keyed by image id without touching `core/`, and that is the wrong
 * trade: issue #1 makes the export archive the only migration path, and `SCHEMA_VERSION` exists so
 * that a record whose shape moved fails loudly. Metadata the archive cannot see would migrate
 * silently and wrongly, which is worse than metadata that is honestly absent. Closing this properly
 * needs a field on `ReferenceImageSchema` and a `SCHEMA_VERSION` bump, which is `core/` work. #77
 * owns it and is blocked on this ticket and #9.
 */
type PickedImage = {
	name: string;
	tag: ImageTag;
	prepared: PreparedImage;
};

const TAG_LABELS: Record<ImageTag, string> = {
	auto: 'Automatic',
	logo: 'Logo',
	ui: 'Interface',
	photo: 'Photograph',
	artwork: 'Artwork',
};

/**
 * Kept apart from `chooseGuidance` so the rule and the sentence move independently. The rule is
 * asserted in `image-set.test.ts`; this table deliberately is not, because `docs/agents/testing.md`
 * says the interface is still moving and pinning wording would make every copy edit a failing test.
 */
const GUIDANCE_COPY: Record<GuidanceKey, string> = {
	empty:
		'Start with whatever carries the brand: a logo, a product screenshot, a poster, a photograph. One image is enough.',
	untagged:
		'Automatic is fine, and the model classifies each image itself. Tag them and Cambium can say what the set is still missing.',
	'needs-mark':
		'Nothing here states the brand colour outright. A logo settles which colour is the brand and which is only the background.',
	'needs-surfaces':
		'A logo gives the colour and the mark. A screenshot would show what the surfaces, the borders, and the type actually do.',
	'needs-mood':
		'The mark and the interface are both covered. A photograph or a poster adds temperature and a wider palette than either carries.',
	full: 'Three is the limit. Remove one to put something else in.',
};

const OVER_LIMIT_NOTICE = 'Three images is the limit, so the rest were left out.';

function kB(bytes: number): string {
	return `${Math.round(bytes / 1000)} kB`;
}

/**
 * Names what actually arrived, where the bytes say so. An iPhone hands over HEIC under whatever
 * extension the share sheet chose, and "that is not a PNG" is unhelpful advice to somebody looking
 * at a file called `logo.png`.
 */
function rejectionNotice(name: string, detected: string | null): string {
	return detected
		? `${name} looks like ${detected}. Cambium reads PNG, JPEG, and WebP.`
		: `${name} is not a PNG, JPEG, or WebP.`;
}

export type UploadFormProps = {
	/** Called once the record is written, with the id the route then addresses it by. */
	onSaved: (recordId: string) => void;
};

export function UploadForm({ onSaved }: UploadFormProps) {
	const [picked, setPicked] = useState<PickedImage[]>([]);
	const [brandUrl, setBrandUrl] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const pickerId = useId();
	const brandUrlId = useId();

	/**
	 * Guards the save against re-entry, and a ref rather than `busy` because that is the whole point.
	 * A state update is not visible until the next render, so two submit events landing in one tick
	 * both read `busy` as false and both run, however the button is styled. This flag flips
	 * synchronously.
	 *
	 * It is never reset on success. The route swaps this form for the saved panel, and a save that
	 * has already written must not be allowed to run again while that navigation is in flight.
	 */
	const saving = useRef(false);

	const guidance = GUIDANCE_COPY[chooseGuidance(picked.map((image) => image.tag))];
	const atLimit = picked.length >= MAX_REFERENCE_IMAGES;

	async function acceptFiles(files: File[]) {
		setBusy(true);
		setNotice(null);

		try {
			// The picker is disabled while this runs, so the count read here cannot move underneath it.
			const room = MAX_REFERENCE_IMAGES - picked.length;
			const rejected: string[] = [];
			const accepted: PickedImage[] = [];

			for (const file of files.slice(0, room)) {
				// A file whose signature is right and whose body is truncated still throws out of the
				// decoder. One bad file must not take the rest of the batch with it, and the picker is
				// the last place anyone can do anything about it.
				//
				// Sequential on purpose, against the lint rule's advice. `Promise.all` would hold three
				// full-resolution decodes in memory at once, and iOS enforces a hard canvas ceiling that
				// `lib/image-intake.ts` already closes every bitmap to stay under. Three images is a
				// small enough batch that the wall-clock difference is not worth that risk.
				// oxlint-disable-next-line no-await-in-loop
				const result = await prepareReferenceImage(file).catch(() => null);

				if (!result) {
					rejected.push(`${file.name} could not be read. The file may be damaged.`);
					continue;
				}

				if (result.kind === 'unsupported') {
					rejected.push(rejectionNotice(file.name, result.rejected.detected));
					continue;
				}

				accepted.push({ name: file.name, tag: DEFAULT_IMAGE_TAG, prepared: result.prepared });
			}

			if (accepted.length > 0) setPicked((current) => [...current, ...accepted]);

			const messages = [...rejected];
			if (files.length > room) messages.push(OVER_LIMIT_NOTICE);

			setNotice(messages.length > 0 ? messages.join(' ') : null);
		} finally {
			setBusy(false);
		}
	}

	function onPick(event: ChangeEvent<HTMLInputElement>) {
		// Copied out before the input is cleared, and that order is the whole point. A `FileList` is a
		// live view of the input, so clearing the input empties the same object this holds. Reading it
		// afterwards found zero files and silently picked nothing.
		const files = Array.from(event.target.files ?? []);

		// Cleared so picking the same file twice running still fires a change event. The input holds
		// nothing worth keeping: `picked` is the record of what was accepted.
		event.target.value = '';

		if (files.length > 0) void acceptFiles(files);
	}

	function retag(index: number, tag: ImageTag) {
		setPicked((current) => current.map((image, at) => (at === index ? { ...image, tag } : image)));
	}

	function remove(index: number) {
		setPicked((current) => current.filter((_, at) => at !== index));
		setNotice(null);
	}

	/**
	 * Writes one record, once.
	 *
	 * `RecordStore.put` rejects a write that is not strictly ahead of what is stored, so putting the
	 * same record twice fails and the recovery is delete-then-put. This route never needs that
	 * recovery, and the reason is worth stating because it is the only thing holding: the id is
	 * minted inside this function and nothing keeps it afterwards, so every save is a record storage
	 * has not seen and a retry after a failure is a new record rather than a second attempt at the
	 * old one. Hoisting that `crypto.randomUUID()` out to component state would quietly turn a retry
	 * into a rejected re-put.
	 *
	 * The other two ways in are closed above and below: `saving` stops a double submit reaching this
	 * twice, and `onSaved` sits outside the catch so a write that landed can never be reported as one
	 * that did not.
	 */
	async function save() {
		if (saving.current) return;
		saving.current = true;
		setBusy(true);
		setNotice(null);

		let savedId: string;

		try {
			// Every one of these is dynamic on purpose. `core/brand-record` and the IndexedDB store both
			// pull zod in at module scope, which `app/state/workspace-store.ts` measures at 93 kB against
			// the 24 kB of first-load headroom ADR-0002 reserves. `pnpm test:bundle` is what actually
			// holds this; the comment only says why.
			const [{ SCHEMA_VERSION }, { createIndexedDbRecordStore }, storage] = await Promise.all([
				import('../../core/brand-record'),
				import('../../app/storage/indexed-db-record-store'),
				import('../../app/storage/storage-estimate'),
			]);

			const record: BrandRecord = {
				id: crypto.randomUUID(),
				schemaVersion: SCHEMA_VERSION,
				images: picked.map((image) => image.prepared.image),
				// No versions yet. Producing the first one needs a key and a model call, which is #23.
				versions: [],
			};

			const store = await createIndexedDbRecordStore();

			// The resolved value is ignored rather than assumed absent: #67 changes `put` to resolve with
			// the record as stored. Nothing here writes twice, so there is nothing to carry forward.
			await store.put(record);
			savedId = record.id;

			// `storage-estimate.ts` assigns this call to "the flow that saves a brand for the first
			// time", which is this one, and warns it must not take the save down with it. Firefox answers
			// with a permission prompt, so it runs after the write rather than before, and a refusal is
			// not something to report.
			void storage.requestPersistentStorage().catch(() => undefined);
		} catch (error) {
			saving.current = false;
			setBusy(false);
			setNotice(
				error instanceof Error && error.name === 'StorageQuotaExceededError'
					? 'This browser is out of room, so nothing was saved.'
					: 'Saving failed, so nothing was stored. Try again.',
			);

			return;
		}

		// Outside the catch on purpose. The record is written by the time this runs, so a failure here
		// is a failure to navigate, and letting it fall into a handler that says "nothing was stored"
		// would invite a retry that writes a second copy of work the user already has.
		//
		// `busy` stays set. The route replaces this form with the saved panel, and clearing it first
		// would flash an enabled button over a form that is already gone.
		onSaved(savedId);
	}

	return (
		<form
			className="flex w-full flex-col gap-6"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium" htmlFor={pickerId}>
					Reference images
				</label>
				{/* `accept` is a convenience for the file dialog and nothing more. The gate is
				    `prepareReferenceImage`, which reads magic bytes, because a renamed file satisfies both
				    the extension filter and `File.type`. */}
				<input
					accept="image/png,image/jpeg,image/webp"
					className="block w-full cursor-pointer rounded-md border border-dashed border-border bg-background p-6 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
					disabled={busy || atLimit}
					id={pickerId}
					multiple
					onChange={onPick}
					type="file"
				/>
				<p className="text-muted-foreground text-sm">{guidance}</p>
			</div>

			{notice && (
				<p className="text-destructive text-sm" role="alert">
					{notice}
				</p>
			)}

			{picked.length > 0 && (
				<ul className="flex flex-col gap-3">
					{picked.map(({ name, tag, prepared }, index) => (
						<li
							className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
							key={prepared.image.id}
						>
							<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
							{/* The figures come off the stored blob rather than off the resize that was asked
							    for, which is the one thing that makes them true. See `lib/image-intake.ts`. */}
							<span className="text-muted-foreground text-xs tabular-nums">
								{prepared.width} × {prepared.height}, {kB(prepared.bytes)}
							</span>
							<label className="sr-only" htmlFor={`${pickerId}-tag-${index}`}>
								Type of {name}
							</label>
							{/* Both controls follow the submit button into `disabled` while a save runs, and that
							    is the whole fix for a real defect rather than tidiness. `save` closes over the
							    `picked` of the render that created it, which is correct: that array is what the
							    user meant when they pressed the button. What was wrong is that the interface
							    went on offering edits across the awaited dynamic imports, so a Remove clicked
							    during "Working…" redrew the list and changed nothing about the record being
							    written. Offering an action whose effect cannot land is the bug; reading the
							    array later is not, and locking it earlier would change nothing. */}
							<select
								className="h-8 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
								disabled={busy}
								id={`${pickerId}-tag-${index}`}
								onChange={(event) => retag(index, event.target.value as ImageTag)}
								value={tag}
							>
								{IMAGE_TAGS.map((option) => (
									<option key={option} value={option}>
										{TAG_LABELS[option]}
									</option>
								))}
							</select>
							<Button
								disabled={busy}
								onClick={() => remove(index)}
								size="sm"
								type="button"
								variant="ghost"
							>
								Remove
							</Button>
						</li>
					))}
				</ul>
			)}

			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium" htmlFor={brandUrlId}>
					Brand site <span className="text-muted-foreground font-normal">(optional)</span>
				</label>
				<input
					className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
					id={brandUrlId}
					inputMode="url"
					onChange={(event) => setBrandUrl(event.target.value)}
					placeholder="https://example.com"
					type="url"
					value={brandUrl}
				/>
				{/* Captured and never fetched. Nothing on this route makes a network call, and crawling a
				    site somebody named would be a different product with a different privacy story.
				    It reaches no further than this form for now, for the same reason the tag above does:
				    `BrandRecordSchema` is strict and has no field for it. #77 adds one. */}
				{/* The copy has to match what actually happens. Saying it is kept "with the record" read
				    as a promise the strict schema above cannot honour yet. */}
				<p className="text-muted-foreground text-sm">
					Cambium never opens it, and it is not saved with the record yet.
				</p>
			</div>

			<Button disabled={picked.length < MIN_REFERENCE_IMAGES || busy} type="submit">
				{busy ? 'Working…' : 'Save these references'}
			</Button>
		</form>
	);
}
