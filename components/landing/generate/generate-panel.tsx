'use client';

import { useRouter } from 'next/navigation';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { RECORD_PARAM } from '@/components/stored-record';
import { Button } from '@/components/ui/button';

import type { ReferenceImage } from '../../../core/brand-record';
import type { CostEstimate, ImageDimensions } from '../../../app/generation/cost-estimate';
import type { FailureDescriptor } from '../../../app/generation/describe-failure';
import type { HeldSeed } from '../../../app/generation/generate';
import type { SeedRepair } from '../../../app/readers/anthropic-reader';
import { getSessionKey, setSessionKey } from '../../../app/generation/session-key';

// Loaded when the person first needs it. base-ui's dialog is weight this panel has no use for until
// then.
const KeyDialog = lazy(() => import('./key-dialog'));

export type GeneratePanelProps = {
	recordId: string;
	images: ReferenceImage[];
	/** Told whether a key is now in session storage, so the route's indicator stays true. */
	onKeyStored: (stored: boolean) => void;
};

/**
 * Carries the formatted ceiling, so the render never touches the formatter's module. The measured
 * dimensions ride along so a repair can be priced without decoding the images again.
 */
type Estimate =
	| { kind: 'pending' }
	| { kind: 'ready'; value: CostEstimate; maxUsdText: string; dimensions: ImageDimensions[] }
	| { kind: 'failed' };

type RepairEstimate = { kind: 'ready'; maxUsdText: string } | { kind: 'failed' };

// Type-only, so the landing bundle loads the module only when a run starts.
type GenerationModule = typeof import('../../../app/generation/generate');

/**
 * `held` is the paid seed a storage failure hands back, kept so "Save again" can commit it without
 * a second paid read. It keeps the read's request id too, so a save-again that fails can still name
 * the request that was billed. `repairEstimate` is set only when the recovery is a repair.
 *
 * `unexpected` carries a request id only when a paid read preceded the throw.
 */
type ShownFailure =
	| {
			kind: 'described';
			descriptor: FailureDescriptor;
			held: HeldSeed | null;
			repairEstimate?: RepairEstimate;
	  }
	| { kind: 'unexpected'; requestId?: string };

/**
 * Why the dialog is open decides what submitting it does. Only `generate` runs a model call, and it
 * carries the repair that was asked for, so entering a key on the way to a repair still sends one.
 */
type DialogIntent = { kind: 'generate'; repair?: SeedRepair } | { kind: 'update'; notice?: string };

type Attempt =
	| { kind: 'generate'; key: string; repair?: SeedRepair }
	| { kind: 'save-again'; held: HeldSeed };

const count = new Intl.NumberFormat('en-US');

/**
 * `cost-estimate.ts` takes dimensions, and `ReferenceImage` stores none, so each downscaled image
 * is decoded once here. The bitmap is closed straight away because only its size is wanted.
 */
async function measure(dataUrl: string): Promise<{ width: number; height: number }> {
	const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

	try {
		return { width: bitmap.width, height: bitmap.height };
	} finally {
		bitmap.close();
	}
}

export function GeneratePanel({ recordId, images, onKeyStored }: GeneratePanelProps) {
	const router = useRouter();
	const [estimate, setEstimate] = useState<Estimate>({ kind: 'pending' });
	const [running, setRunning] = useState(false);
	const [shown, setShown] = useState<ShownFailure | null>(null);
	const [dialog, setDialog] = useState<DialogIntent | null>(null);
	const [keyNotKept, setKeyNotKept] = useState(false);

	/**
	 * The same guard `UploadForm.save()` uses, for the same reason: `running` isn't visible until the
	 * next render, so two clicks in one tick would both start a run, and the second would commit a
	 * second version behind the first. This flips synchronously.
	 *
	 * Left set after a success, because the route is navigating away and a version already landed.
	 */
	const inFlight = useRef(false);

	/**
	 * Set for a generation from the click until its commit starts or its failure is shown, so it covers
	 * the record and font lookups before the model call too. Either can stall with no timeout, the
	 * record behind another tab and the font table on a CDN, and each wait ends on abort. A save-again
	 * makes no call and leaves this null.
	 */
	const [abort, setAbort] = useState<AbortController | null>(null);

	// A run that finishes after the person left the page mustn't drag them to the workspace.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		let live = true;

		void (async () => {
			try {
				// Dynamic because the estimate measures the real request body, and the prompt module behind
				// it pulls in zod through `core/brand-seed`.
				const [cost, dimensions] = await Promise.all([
					import('../../../app/generation/cost-estimate'),
					Promise.all(images.map((image) => measure(image.downscaled))),
				]);

				const value = cost.estimateGenerationCost({
					images: dimensions,
					promptChars: cost.generationPromptChars(images),
				});

				if (live) {
					setEstimate({
						kind: 'ready',
						value,
						maxUsdText: cost.formatUsdCeiling(value.maxUsd),
						dimensions,
					});
				}
			} catch {
				if (live) setEstimate({ kind: 'failed' });
			}
		})();

		return () => {
			live = false;
		};
	}, [images]);

	/**
	 * #23 wants a cost shown before every generation, and a repair is one. It resends the images
	 * under the same output ceiling and adds the answer being fixed and its issues, so it costs at
	 * least as much as the first run. Never throws, since a price it can't work out is still
	 * something to say next to the button.
	 */
	async function priceRepair(repair: SeedRepair): Promise<RepairEstimate> {
		if (estimate.kind !== 'ready') return { kind: 'failed' };

		try {
			const cost = await import('../../../app/generation/cost-estimate');
			const value = cost.estimateGenerationCost({
				images: estimate.dimensions,
				promptChars: cost.generationPromptChars(images, repair),
			});

			return { kind: 'ready', maxUsdText: cost.formatUsdCeiling(value.maxUsd) };
		} catch {
			return { kind: 'failed' };
		}
	}

	/**
	 * Every path into a model call or a commit goes through here, and each one starts from a click.
	 * Nothing schedules a run. A rate limit's retry window is shown as text and left to the person,
	 * because every read spends their money.
	 *
	 * The record is read fresh from storage each time rather than taken from props. A stale-record
	 * failure says "save again to add it to the latest copy", and only a fresh read makes that true.
	 */
	async function run(attempt: Attempt) {
		if (inFlight.current) return;
		inFlight.current = true;
		setRunning(true);

		// A save-again makes no model call, so there's nothing slow enough to be worth cancelling.
		const controller = attempt.kind === 'generate' ? new AbortController() : null;
		setAbort(controller);

		const signal = controller?.signal;
		let next: ShownFailure;
		// Kept outside the `try` so the catch can tell a paid read's failure from any other.
		let PaidReadError: GenerationModule['UnexpectedAfterPaidReadError'] | undefined;

		try {
			const [generation, { describeFailure }, storage, { createOklchScaleEngine }] =
				await Promise.all([
					import('../../../app/generation/generate'),
					import('../../../app/generation/describe-failure'),
					import('../../../app/storage/indexed-db-record-store'),
					import('../../../core/oklch-scale-engine'),
				]);

			PaidReadError = generation.UnexpectedAfterPaidReadError;

			// Cancel is on screen from the click, and neither the open nor the read before the request takes
			// a signal. Another tab can hold the open behind an upgrade and the read behind a write, with no
			// timeout on either, so both race the abort the way the font lookup does. Nothing was sent, so
			// nothing was billed.
			const cancelled = () =>
				generation.cancelledFailure('The run was cancelled before anything was sent.', signal);
			const opening = storage.createIndexedDbRecordStore();
			const recordStore = await generation.unlessAborted(() => opening, signal);
			let result: Awaited<ReturnType<typeof generation.generate>>;

			if (recordStore === generation.ABORTED) {
				// The open carries on without this run. This closes it once it lands, because an open
				// connection is what an upgrade in another tab waits on forever. A rejected open has nothing
				// to close.
				void opening.then(storage.closeIndexedDbRecordStore, () => {});
				result = cancelled();
			} else {
				try {
					const record = await generation.unlessAborted(() => recordStore.get(recordId), signal);

					if (record === generation.ABORTED) {
						result = cancelled();
					} else {
						if (!record) throw new Error('the record is no longer stored');

						const engine = createOklchScaleEngine();

						result =
							attempt.kind === 'generate'
								? await generation.generate({
										record,
										key: attempt.key,
										reader: generation.createGenerationReader(),
										recordStore,
										engine,
										repair: attempt.repair,
										signal,
										// Past this point the answer is paid for and the abort is never checked again, so
										// a Cancel left on screen would swallow the click. The commit can stall behind
										// another tab's write for as long as that write takes.
										onCommitting: () => setAbort(null),
									})
								: await generation.saveGeneratedVersion({
										record,
										...attempt.held,
										recordStore,
										engine,
									});
					}
				} finally {
					// Same reason as the route's read-back: an open connection is what an upgrade in another
					// tab waits on forever. A read the abort left pending still finishes first.
					storage.closeIndexedDbRecordStore(recordStore);
				}
			}

			if (result.ok) {
				if (mounted.current) router.push(`/workspace?${RECORD_PARAM}=${result.record.id}`);
				return;
			}

			const { failure } = result;
			// A repair gets one go per answer. The run that just failed was that go if it carried one.
			const descriptor = describeFailure(failure, {
				repairUsed: attempt.kind === 'generate' && attempt.repair !== undefined,
			});

			next = {
				kind: 'described',
				descriptor,
				held:
					'seed' in failure
						? {
								seed: failure.seed,
								provenance: failure.provenance,
								...(failure.requestId ? { requestId: failure.requestId } : {}),
							}
						: null,
				repairEstimate:
					descriptor.recovery === 'repair-retry' && descriptor.repair
						? await priceRepair(descriptor.repair)
						: undefined,
			};
		} catch (error) {
			// `generate` throws only for failures it has no recovery for, and a chunk or the database can
			// fail before it runs. Nothing is logged, because the thrown value could be anything and the
			// key must never reach the console. A save-again's paid read happened before this attempt, so
			// `attempt.held.requestId` still names the billed request whatever the commit just threw; a
			// `generate` attempt has no such fallback, so it names one only via the wrapped paid-read error.
			next =
				PaidReadError && error instanceof PaidReadError
					? { kind: 'unexpected', requestId: error.requestId }
					: attempt.kind === 'save-again'
						? {
								kind: 'unexpected',
								...(attempt.held.requestId ? { requestId: attempt.held.requestId } : {}),
							}
						: { kind: 'unexpected' };
		}

		inFlight.current = false;
		setRunning(false);
		setAbort(null);
		setShown(next);

		// #23: a rejected key reopens the dialog by itself, and the key stays in session. The outcome's
		// own button is there for after the dialog is dismissed.
		if (next.kind === 'described' && next.descriptor.recovery === 'reopen-key-dialog') {
			setDialog({ kind: 'update', notice: next.descriptor.message });
		}
	}

	/**
	 * The one way into a model call from a click, repair or not. #23 asks for the key at first
	 * generation, never on arrival, so with none in session this opens the dialog and lets its
	 * submit carry on with the same repair.
	 */
	function startGenerate(repair?: SeedRepair) {
		const key = getSessionKey();

		if (!key) {
			setDialog({ kind: 'generate', repair });
			return;
		}

		void run({ kind: 'generate', key, repair });
	}

	function acceptKey(key: string) {
		const kept = setSessionKey(key);
		setKeyNotKept(!kept);
		onKeyStored(kept);

		const intent = dialog;
		setDialog(null);

		if (intent?.kind === 'generate') {
			// Passed on directly rather than re-read, so a browser that refused to keep it still gets this
			// one generation out of it.
			void run({ kind: 'generate', key, repair: intent.repair });
		} else {
			// Updating the key after a rejection runs nothing, since #23 forbids an automatic retry.
			// Generate comes back and the person decides.
			setShown(null);
		}
	}

	const estimateReady = estimate.kind !== 'pending';

	// While a failure is showing, its own control is the way forward, and a second button doing the
	// same thing would muddle which one to press. A recovery of `none` means there isn't one.
	const generateDisabled = running || !estimateReady || shown !== null;

	return (
		<div className="flex w-full flex-col items-start gap-4">
			<p className="text-muted-foreground text-sm" data-estimate>
				{estimate.kind === 'pending' && 'Working out what this will cost…'}
				{estimate.kind === 'ready' &&
					`Generating costs at most ${estimate.maxUsdText} on your Anthropic account: about ${count.format(estimate.value.inputTokens)} input tokens and at most ${count.format(estimate.value.maxOutputTokens)} output tokens.`}
				{estimate.kind === 'failed' &&
					"Cambium couldn't read these images back to estimate the cost, so it can't say what generating will spend."}
			</p>

			<Button disabled={generateDisabled} onClick={() => startGenerate()}>
				Generate
			</Button>

			{running && (
				<p aria-live="polite" className="text-muted-foreground text-sm">
					Generating. This usually takes under a minute.
				</p>
			)}

			{/* No timeout stands in for this. A slow read may be a paid one still on its way back, so
			    only the person decides when to give up on it. */}
			{abort && (
				<Button onClick={() => abort.abort()} variant="outline">
					Cancel
				</Button>
			)}

			{keyNotKept && (
				<p className="text-muted-foreground text-sm">
					This browser wouldn&apos;t keep the key for the tab, so Cambium will ask for it again next
					time.
				</p>
			)}

			{shown && (
				<FailureNotice
					disabled={running}
					onRepair={(repair) => startGenerate(repair)}
					onRetry={() => startGenerate()}
					onSaveAgain={(held) => void run({ kind: 'save-again', held })}
					onUpdateKey={() => setDialog({ kind: 'update' })}
					shown={shown}
				/>
			)}

			{dialog && (
				<Suspense fallback={null}>
					<KeyDialog
						notice={dialog.kind === 'update' ? dialog.notice : undefined}
						onOpenChange={(open) => {
							if (!open) setDialog(null);
						}}
						onSubmit={acceptKey}
						open
					/>
				</Suspense>
			)}
		</div>
	);
}

type FailureNoticeProps = {
	shown: ShownFailure;
	disabled: boolean;
	onUpdateKey: () => void;
	onRetry: () => void;
	onRepair: (repair: SeedRepair) => void;
	onSaveAgain: (held: HeldSeed) => void;
};

/** What support needs to look a charge up, shown wherever a failure followed a paid read. */
function RequestId({ id }: { id: string }) {
	return (
		<p className="text-muted-foreground text-xs">
			Anthropic request id: <code className="bg-muted rounded px-1 py-0.5">{id}</code>
		</p>
	);
}

/**
 * One failure and the one control its descriptor names. The copy is `describeFailure`'s alone, so
 * the words and the recovery can't drift apart here.
 */
function FailureNotice({
	shown,
	disabled,
	onUpdateKey,
	onRetry,
	onRepair,
	onSaveAgain,
}: FailureNoticeProps) {
	if (shown.kind === 'unexpected') {
		// No retry, because whatever threw may have thrown after a write. A reload shows what storage
		// holds.
		return (
			<div
				className="flex w-full flex-col items-start gap-3"
				data-outcome="unexpected"
				role="alert"
			>
				<p className="text-destructive text-sm">
					Generation stopped on an error Cambium didn&apos;t expect. Reload the page to see whether
					anything was saved.
				</p>

				{shown.requestId && <RequestId id={shown.requestId} />}
			</div>
		);
	}

	const { descriptor, held, repairEstimate } = shown;

	return (
		<div
			className="flex w-full flex-col items-start gap-3"
			data-outcome={descriptor.kind}
			role="alert"
		>
			<p className="text-destructive text-sm">{descriptor.message}</p>

			{descriptor.requestId && <RequestId id={descriptor.requestId} />}

			{descriptor.raw && (
				<details className="w-full text-sm">
					<summary className="text-muted-foreground cursor-pointer">
						What Anthropic sent back
					</summary>
					<pre className="bg-muted mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
						{descriptor.raw}
					</pre>
				</details>
			)}

			{descriptor.recovery === 'reopen-key-dialog' && (
				<Button disabled={disabled} onClick={onUpdateKey} variant="outline">
					Update API key
				</Button>
			)}

			{descriptor.recovery === 'manual-retry' && (
				<Button disabled={disabled} onClick={onRetry} variant="outline">
					Retry
				</Button>
			)}

			{descriptor.recovery === 'repair-retry' && descriptor.repair && repairEstimate && (
				<p className="text-muted-foreground text-sm" data-estimate>
					{repairEstimate.kind === 'ready'
						? `A repair is a second request that sends your images again, so it costs up to ${repairEstimate.maxUsdText} more on your Anthropic account.`
						: "A repair is a second request that sends your images again. Cambium couldn't work out what it will cost."}
				</p>
			)}

			{descriptor.recovery === 'repair-retry' && descriptor.repair && (
				<Button
					disabled={disabled}
					onClick={() => {
						if (descriptor.repair) onRepair(descriptor.repair);
					}}
					variant="outline"
				>
					Ask for a repair
				</Button>
			)}

			{descriptor.recovery === 'save-again' && held && (
				<Button disabled={disabled} onClick={() => onSaveAgain(held)} variant="outline">
					Save again
				</Button>
			)}
		</div>
	);
}
