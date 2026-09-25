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
import {
	ACCEPTED_IMAGE_TYPES,
	type PreparedImage,
	prepareReferenceImage,
} from '@/lib/image-intake';

import type { BrandRecord } from '../../core/brand-record';

/**
 * A picked image as the form holds it: what was stored, what the person called it, and the tag they
 * applied.
 *
 * `tag` lives here rather than on `PreparedImage`, because intake runs before a person has chosen
 * one. `save` below folds it onto `prepared.image` to build the `ReferenceImage`
 * `ReferenceImageSchema` now requires (#77).
 */
type PickedImage = {
	name: string;
	tag: ImageTag;
	prepared: PreparedImage;
};

/** Exported so the saved view in `landing-route.tsx` prints the same words the picker offered. */
export const TAG_LABELS: Record<ImageTag, string> = {
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

const UNEXAMINED_NOTICE =
	'Too many files in a row could not be read, so the rest were left unchecked.';

/**
 * How many files may cost a full decode and fail before the picker stops looking.
 *
 * `<input multiple>` has no cap, so the dialog can hand over hundreds. A file that clears the
 * twelve-byte signature and then fails to decode pays a whole `createImageBitmap` without ever
 * filling a slot, so nothing in the loop advances and the work is bounded only by how many files
 * were picked. `files.slice(0, room)` used to bound it, and dropping that slice is what let a usable
 * file sit behind an unusable one; this restores the bound without going back to that trade.
 *
 * Only decodes are budgeted. A file refused on its signature costs twelve bytes, so a wall of GIFs
 * still cannot stop a PNG behind them from being found.
 *
 * Three, matching the slot count, because this guards a mis-picked handful rather than a deliberate
 * flood, and somebody whose fourth file in a row will not decode has a problem this picker cannot
 * solve for them.
 */
const FAILED_DECODE_BUDGET = MAX_REFERENCE_IMAGES;

/**
 * How many per-file rejections are spelled out before the rest are counted.
 *
 * Same uncapped picker: one sentence per rejected file turns a mis-selected folder into a wall of
 * text nobody reads.
 */
const MAX_SPELLED_OUT_REJECTIONS = 3;

/**
 * One formatter, because two of them disagreed. The row printed raw blob bytes as kB while the
 * over-budget message printed base64-inflated bytes as MB, so a 6 MB file was reported as "too big
 * at 8.0 MB" against a ceiling the user had no way to compare it to.
 */
function sizeLabel(bytes: number): string {
	return bytes >= 1_000_000
		? `${(bytes / 1_000_000).toFixed(1)} MB`
		: `${Math.round(bytes / 1000)} kB`;
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

			let overflowed = 0;
			let unexamined = 0;
			let failedDecodes = 0;

			for (const file of files) {
				// Counted against the limit only once a file has proved usable. Slicing the list to `room`
				// first spends a slot on a file that will occupy none: with one slot left and a GIF picked
				// ahead of a PNG, the GIF was rejected and the PNG was never looked at, so the file the
				// user could actually use was dropped because of one they could not. The limit is also
				// reported off this counter now, because `files.length > room` called it a limit problem
				// when the limit had not been reached.
				if (accepted.length >= room) {
					overflowed += 1;
					continue;
				}

				// The bound `files.slice(0, room)` used to give, restored where it costs nothing. Only a
				// file that reaches the decoder spends this budget, so a wall of GIFs still cannot hide a
				// PNG behind it.
				if (failedDecodes >= FAILED_DECODE_BUDGET) {
					unexamined += 1;
					continue;
				}

				// A file whose signature is right and whose body is truncated still throws out of the
				// decoder. One bad file must not take the rest of the batch with it, and the picker is
				// the last place anyone can do anything about it.
				//
				// Sequential on purpose, against the lint rule's advice. `Promise.all` would hold three
				// full-resolution decodes in memory at once, and iOS enforces a hard canvas ceiling that
				// `lib/image-intake.ts` already closes every bitmap to stay under. Three images is a
				// small enough batch that the wall-clock difference is not worth that risk.
				// oxlint-disable-next-line no-await-in-loop
				const result = await prepareReferenceImage(file).catch((error: unknown) => {
					// Matched by name, the convention `app/storage/storage-estimate.ts` argues for, because
					// these two failures need opposite advice and a message string cannot tell them apart.
					// An encoder that cannot produce a storable image is not the file's fault: it already
					// cleared the byte gate and decoded, so blaming it sends somebody off to re-export
					// something that was never wrong.
					rejected.push(
						error instanceof Error && error.name === 'ImageEncodeError'
							? `${file.name} could not be prepared by this browser. Try again, or convert it to PNG first.`
							: `${file.name} could not be read. The file may be damaged.`,
					);

					return null;
				});

				// A decode was attempted and lost. `unsupported` below never reaches the decoder, so it
				// costs twelve bytes and spends nothing.
				if (!result) {
					failedDecodes += 1;
					continue;
				}

				if (result.kind === 'unsupported') {
					rejected.push(rejectionNotice(file.name, result.rejected.detected));
					continue;
				}

				if (result.kind === 'too-large') {
					rejected.push(
						`${file.name} is too big to store at ${sizeLabel(result.oversized.bytes)}, against a ${sizeLabel(result.oversized.limit)} ceiling.`,
					);

					// Spends the budget like a failed decode does, because it cost the same work and more: a
					// decode, an encode, and a second decode, with no image to show for it. Exempting it left
					// the run bounded only by how many files were picked, which is the hole this budget was
					// added to close.
					failedDecodes += 1;
					continue;
				}

				accepted.push({ name: file.name, tag: DEFAULT_IMAGE_TAG, prepared: result.prepared });

				// Reset, because the notice says "in a row" and a counter that only ever climbs cannot
				// support that. Left unreset it also dropped usable files with slots free: broken, good,
				// broken, good, broken, good spent the budget on failures that were never consecutive and
				// skipped the last good one. Total decodes stay bounded either way, at
				// `(room + 1) * FAILED_DECODE_BUDGET`, because each reset costs a slot and slots run out.
				failedDecodes = 0;
			}

			if (accepted.length > 0) setPicked((current) => [...current, ...accepted]);

			// Spelled out up to a point, then counted. One sentence per file turns a mis-selected folder
			// into a wall nobody reads.
			const extra = rejected.length - MAX_SPELLED_OUT_REJECTIONS;
			const messages = rejected.slice(0, MAX_SPELLED_OUT_REJECTIONS);

			if (extra > 0) messages.push(`${extra} more ${extra === 1 ? 'file' : 'files'} were refused.`);
			if (overflowed > 0) messages.push(OVER_LIMIT_NOTICE);
			if (unexamined > 0) messages.push(UNEXAMINED_NOTICE);

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
	 * Each call mints a fresh id, so every save is a record storage has not seen. A failed save never
	 * reuses its id, and a retry after a failure is a new record rather than a second attempt at the
	 * old one. On success the id goes to `onSaved`, which puts it in the route's URL, and no later save reads it.
	 * That is the only thing keeping this route clear of the insert limit `wasBuiltOnStored`
	 * describes.
	 *
	 * Hoisting that `crypto.randomUUID()` out to component state would make a retry reuse the id. If
	 * the first write never landed, the retry is a plain first insert and nothing goes wrong. If it
	 * landed and storage still holds the id at `FIRST_REVISION`, `RecordStore.put` cannot tell the
	 * retry from a commit built on the first save, so it stores the retry over what the first save
	 * left. Once the record has moved past `FIRST_REVISION`, the same retry is refused with
	 * `StaleRecordWriteError`.
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
			const [
				{ SCHEMA_VERSION, FIRST_REVISION },
				{ createIndexedDbRecordStore, closeIndexedDbRecordStore },
				storage,
			] = await Promise.all([
				import('../../core/brand-record'),
				import('../../app/storage/indexed-db-record-store'),
				import('../../app/storage/storage-estimate'),
			]);

			const record: BrandRecord = {
				id: crypto.randomUUID(),
				schemaVersion: SCHEMA_VERSION,
				revision: FIRST_REVISION,
				// `tag` folded on here rather than carried on `PreparedImage`: intake runs before the
				// person has chosen one, and this is the one place that holds both halves.
				images: picked.map(({ tag, prepared }) => ({ ...prepared.image, tag })),
				// Trimmed, and empty collapses to null rather than "". `BrandRecordSchema.brandUrl` is
				// `.min(1).nullable()`, so an empty string would fail the parse instead of just meaning
				// "nothing typed".
				brandUrl: brandUrl.trim() || null,
				// No versions yet. Producing the first one needs a key and a model call, which is #23.
				versions: [],
			};

			const store = await createIndexedDbRecordStore();

			try {
				// The resolved record is ignored. Nothing here writes twice, so there is no revision to
				// carry forward.
				await store.put(record);
				savedId = record.id;
			} finally {
				// Closed on every path. A connection left open is what makes an upgrade elsewhere block
				// instead of proceeding, and `openDB` has no `blocked` handler, so the tab that blocks
				// waits forever rather than failing. That gap is filed; leaking connections into it is
				// this route's own contribution and costs nothing to stop.
				closeIndexedDbRecordStore(store);
			}

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
					accept={ACCEPTED_IMAGE_TYPES.join(',')}
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
								{prepared.width} × {prepared.height}, {sizeLabel(prepared.bytes)}
							</span>
							<label className="sr-only" htmlFor={`${pickerId}-tag-${index}`}>
								Type of {name}
							</label>
							{/* Both controls follow the submit button into `disabled` while a save runs. `save`
							    closes over the `picked` of the render that created it, which is the array the
							    user meant when they pressed the button; the defect was an interface that went
							    on offering edits whose effect could not reach the record already being
							    written. */}
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
					// Deliberately not `type="url"`. That attribute brought native constraint validation with
					// it, which refused to submit the form over a field that is optional, is never fetched,
					// and is not even stored yet: "acme.com" is how people write a domain, and typing it left
					// the images unsaved with no message at all, because `save` never ran. `inputMode` is
					// what summons the URL keyboard on a phone, so nothing is lost by dropping the type.
					//
					// `noValidate` on the form was the first fix and is worse. It would switch validation off
					// for every field this form ever grows, so the next one added with a real constraint
					// would fail open and nothing would say so.
					type="text"
					value={brandUrl}
				/>
				{/* Captured and never fetched. Nothing on this route makes a network call, and crawling a
				    site somebody named would be a different product with a different privacy story.
				    `BrandRecordSchema.brandUrl` stores it as plain text for exactly that reason (#77): a
				    field that is never parsed or requested cannot fail on the domains-without-scheme people
				    actually type. */}
				<p className="text-muted-foreground text-sm">Cambium never opens it.</p>
			</div>

			<Button disabled={picked.length < MIN_REFERENCE_IMAGES || busy} type="submit">
				{busy ? 'Working…' : 'Save these references'}
			</Button>
		</form>
	);
}
