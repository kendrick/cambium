import { randomUUID } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import {
	type BrandRecord,
	BrandRecordSchema,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../core/brand-record';
import type { BrandSeed } from '../core/brand-seed';
import { defaultSeedPins } from '../core/seed-pins';

import { expect, test } from './fixtures';

/**
 * Spelled out rather than imported from `components/stored-record.tsx`. The address is a contract
 * with every link and bookmark already out there, so a rename of that constant should fail here
 * rather than move this test along with it.
 */
const RECORD_PARAM = 'record';

/**
 * One key color is the minimum `core/oklch-scale-engine.ts` needs to produce a non-error
 * `ScaleEngineResult`, matching the seed `core/oklch-scale-engine.test.ts` builds for the same
 * reason. Every other field stays null, which `BrandSeedSchema` accepts, because this scenario
 * suite only needs a token list with rows in it, not a particular brand.
 */
const FIXTURE_SEED: BrandSeed = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

/**
 * A record holding one version whose seed derives real tokens, for every scenario below except the
 * landing-to-workspace link, which needs a record the app itself produced.
 *
 * Parsed through `BrandRecordSchema` before anything writes it to IndexedDB, so a shape this schema
 * has moved past fails here, loudly, rather than as a silent mismatch the app's own read-back trips
 * over later. The literal is also held to `BrandRecord` at compile time, because `parse` takes
 * `unknown` and would otherwise let a new required field through until a browser run.
 * `sourceImageId` on the seed's one key color has to name an id this record's `images` actually
 * carries, or the same schema's refinement rejects the fixture outright.
 *
 * `seed` and `rawResponse` are overridable: repair round 1 needs a seed with no key colors (the
 * engine's `no-key-colors` branch) and a version with a null raw response (the re-derivation
 * branch), and both still have to be the one non-empty version most scenarios below want.
 */
function buildRecordWithOneVersion(
	overrides: { seed?: BrandSeed; rawResponse?: string | null } = {},
): BrandRecord {
	const createdAt = new Date().toISOString();
	const { seed = FIXTURE_SEED, rawResponse = 'raw model output held by the e2e fixture' } =
		overrides;

	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
		images: [
			{
				id: 'img-1',
				downscaled: 'data:image/png;base64,AAAA',
				originalHash: 'sha256-fixture',
				tag: 'auto',
			},
		],
		versions: [
			{
				createdAt,
				ordinal: 1,
				seed,
				tokenSet: null,
				provider: 'cambium-e2e-fixture',
				model: 'cambium-e2e-fixture',
				promptVersion: 'cambium-e2e-fixture',
				rawResponse,
				scaleEngine: 'cambium-oklch-1',
				fontTable: { source: 'cambium-e2e-fixture', version: '1' },
				interpretation: 'balanced',
				overrides: [],
				pins: defaultSeedPins(seed),
			},
		],
	} satisfies BrandRecord);
}

/**
 * A record with no versions at all, the state `components/landing/landing-route.tsx` leaves a
 * fresh save in. `derived` stays null for this one (`workspace-store.ts`'s `derive` only runs
 * against a seed), which is the branch `components/workspace/token-list.tsx` takes before any
 * seed exists, distinct from the seed-but-no-key-colors branch `SEED_WITH_NO_KEY_COLORS` reaches.
 */
function buildEmptyRecord(): BrandRecord {
	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
		images: [],
		versions: [],
	} satisfies BrandRecord);
}

/**
 * `core/oklch-scale-engine.ts` returns `{ ok: false, error: { kind: 'no-key-colors' } }` for a
 * seed whose `keyColors` is null, which is the one `derived.ok === false` branch
 * `components/workspace/token-list.tsx` can reach from a real seed.
 */
const SEED_WITH_NO_KEY_COLORS: BrandSeed = { ...FIXTURE_SEED, keyColors: null };

/**
 * Writes one row straight into the `records` object store, bypassing `RecordStore` and the app's
 * own save path entirely. `createIndexedDbRecordStore` (`app/storage/indexed-db-record-store.ts`)
 * calls `openDB(DATABASE_NAME, DATABASE_VERSION, { upgrade })`; this helper opens at the same
 * version, `1`, mirroring `DATABASE_VERSION`, and creates the store the same way that `upgrade`
 * callback does, so an app-side open right after this finds a database already at the version it
 * expects rather than one negotiating a bump.
 *
 * Runs through `page.evaluate` because IndexedDB is scoped to a page's origin, not to this Node
 * process. It has to be called only once `page` already sits on the served origin, which every
 * scenario below gets for free from `cleanIndexedDb` in `./fixtures.ts`, an `auto` fixture that has
 * already navigated there and back before the scenario body starts.
 *
 * Takes `unknown` rather than `BrandRecord`, so a caller can write a row `BrandRecordSchema` would
 * reject—the schema-failing-row scenario needs exactly that, to reach `get`'s own
 * `BrandRecordSchema.parse` on the way out and prove it rejects.
 */
async function writeIndexedDbRow(page: Page, value: unknown): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName, storedValue]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, 1);

				request.addEventListener('upgradeneeded', () => {
					request.result.createObjectStore(storeName, { keyPath: 'id' });
				});
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(storeName, 'readwrite');
					tx.objectStore(storeName).put(storedValue);
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () => reject(tx.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, value] as const,
	);
}

/** A schema-valid record, for every scenario that wants storage to read it back cleanly. */
async function seedWorkspaceRecord(page: Page, record: BrandRecord): Promise<void> {
	await writeIndexedDbRow(page, record);
}

/** What the init script below leaves on `window`, for a scenario to arm, read and release. */
type OpenHold = { armed: boolean; held: number; release: () => void };

type WindowWithOpenHold = Window & { cambiumOpenHold: OpenHold };

/**
 * Lets a scenario park a database open partway through, at the moment a caller is waiting on its
 * `success` event.
 *
 * The record-A-to-B scenario needs record B's own open to still be in flight when it checks that
 * record A's tree has not stayed on screen. Racing that window with a timer is what this replaces:
 * a race is only as reliable as the gap between two measured durations, and on a slow enough host
 * the two can close. Holding the open instead makes the window as wide as the scenario wants, no
 * matter how fast or slow IndexedDB itself runs, because nothing here has to guess how long that
 * takes.
 *
 * The hold sits on `indexedDB.open` for the named database, the one platform call
 * `createIndexedDbRecordStore` has to make before it can do anything else, however Next splits or
 * preloads the route's code. While armed, every `success` listener attached to a matching open
 * request is withheld until `release`, so the request's caller never sees its connection resolve.
 * `held` counts withheld events, which is a scenario's evidence that the hold actually caught an
 * open rather than arming and catching nothing.
 *
 * It wraps listeners rather than the request because `open` has to hand back a real
 * `IDBOpenDBRequest` synchronously, and `idb`'s `openDB` (which `createIndexedDbRecordStore` calls)
 * subscribes with `addEventListener` rather than an `onsuccess` property.
 */
async function installOpenHold(page: Page, databaseName: string): Promise<void> {
	await page.addInitScript((name) => {
		const realOpen = IDBFactory.prototype.open;
		let releaseAll!: () => void;
		const released = new Promise<void>((resolve) => {
			releaseAll = resolve;
		});

		const hold: OpenHold = {
			armed: false,
			held: 0,
			release: () => {
				hold.armed = false;
				releaseAll();
			},
		};

		(window as unknown as WindowWithOpenHold).cambiumOpenHold = hold;

		IDBFactory.prototype.open = function open(this: IDBFactory, ...args: [string, number?]) {
			const request = realOpen.apply(this, args);

			if (!hold.armed || args[0] !== name) return request;

			const realAdd = request.addEventListener.bind(request);

			request.addEventListener = ((
				type: string,
				listener: EventListenerOrEventListenerObject | null,
				options?: boolean | AddEventListenerOptions,
			) => {
				// Adding a null listener is a no-op in the platform too.
				if (!listener) return;

				if (type !== 'success') {
					realAdd(type, listener, options);
					return;
				}

				const deferred = listener;

				realAdd(
					type,
					(event: Event) => {
						hold.held += 1;
						void (async () => {
							await released;
							if (typeof deferred === 'function') deferred.call(request, event);
							else deferred.handleEvent(event);
						})();
					},
					options,
				);
			}) as typeof request.addEventListener;

			return request;
		};
	}, databaseName);
}

/**
 * `Locator.boundingBox()` types its result nullable for an element that isn't rendered, which each
 * geometry scenario below has already ruled out with a `toBeVisible()` wait. This gives that
 * guarantee a type the comparisons can read without repeating the null check at every call.
 */
async function requireBox(
	locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('expected the element to have a bounding box');
	return box;
}

test('the seed section sits above a non-empty token list in the left rail', async ({ page }) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const seedSection = page.getByRole('region', { name: 'Seed' });
	const tokensSection = page.getByRole('region', { name: 'Tokens' });
	const tokenRows = tokensSection.getByRole('listitem');

	await expect(tokenRows.first()).toBeVisible();
	expect(await tokenRows.count()).toBeGreaterThan(0);

	const seedBox = await requireBox(seedSection);
	const tokensBox = await requireBox(tokensSection);

	// Both sections live in the same flex column, so a smaller top offset is what "above" comes
	// down to for two boxes that never overlap in that column.
	expect(seedBox.y).toBeLessThan(tokensBox.y);
});

test('a seed with no key colors renders the token list error branch, distinct from having no seed at all', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion({ seed: SEED_WITH_NO_KEY_COLORS });
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokensSection = page.getByRole('region', { name: 'Tokens' });

	// `components/workspace/token-list.tsx`'s `!derived.ok` branch is the only one of its three
	// that puts a `<code>` element inside the Tokens region: the no-seed branch is a bare `<p>`,
	// and the success branch has no `<code>` at all. Structure, not the error kind's own text, is
	// what tells this branch apart from "no seed yet"—both render one paragraph of copy.
	await expect(tokensSection.locator('code')).toBeVisible();
	await expect(tokensSection.getByRole('listitem')).toHaveCount(0);
});

test('the output column exposes preview, accessibility and export as tabs', async ({ page }) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	await expect(page.getByRole('tablist')).toBeVisible();
	// `components/workspace/shell.tsx`'s `TabsList` carries its own `aria-label`; an unnamed tab
	// list announces as bare "tab list" to a screen reader, with nothing to say which tabs these are.
	await expect(page.getByRole('tablist')).toHaveAccessibleName('Output');

	for (const name of ['Preview', 'Accessibility', 'Export']) {
		const tab = page.getByRole('tab', { name });

		await tab.click();

		await expect(tab).toHaveAttribute('aria-selected', 'true');
		// Scoped by the same name as the tab, not just role: base-ui's exit transition leaves the
		// previous panel in the DOM, `inert` but not yet `hidden`, for as long as its own animation
		// runs, so an unscoped `getByRole('tabpanel')` can resolve to two elements mid-switch. Each
		// panel's `aria-labelledby` points at its own tab, so its accessible name is that tab's name.
		await expect(page.getByRole('tabpanel', { name })).toBeVisible();
	}
});

test('switching the interpretation preset re-derives tokens and makes no network request', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	const requestUrls: string[] = [];
	// Attached before the navigation that follows, so it also catches the initial load's own
	// requests; those are only read for their count, never asserted against, which is what makes the
	// count taken right before the switch below a clean baseline regardless of how many of them
	// there were.
	page.on('request', (request) => requestUrls.push(request.url()));

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokenRows = page.getByRole('region', { name: 'Tokens' }).getByRole('listitem');
	await expect(tokenRows.first()).toBeVisible();

	const requestsBeforeSwitch = requestUrls.length;

	// `PRESET_PARAMS` in `app/state/workspace-store.ts` maps every preset to the same `BALANCED`
	// params until #37, so this proves the re-derive path stays offline rather than proving the two
	// presets disagree.
	await page.getByLabel('Interpretation').selectOption('faithful');

	// A controlled `<select>` snaps back to its last-rendered `value` prop once React's event
	// system finishes handling the change, whether or not the `onChange` handler itself did
	// anything: `components/workspace/seed-rail.tsx` has no state of its own, so this only stays on
	// 'faithful' if `onSelectPreset` reached the store and a re-render came back with it selected.
	await expect(page.getByLabel('Interpretation')).toHaveValue('faithful');

	await expect(tokenRows.first()).toBeVisible();
	expect(await tokenRows.count()).toBeGreaterThan(0);

	// A fixed wait only proves no request landed inside whatever window it measured, which is a
	// number this test made up rather than one anything about the app promises. Switching the
	// preset back is a real event to tie the window to instead: it forces a second re-render, and
	// `toHaveValue` below settles only once that render has actually committed, not after a
	// guessed duration. The listener above has been attached since before the first switch, so
	// reading its count after this one covers both switches, the whole of what this scenario does
	// to the store. What it still cannot see is a request slow enough to arrive after this test has
	// already finished—this closes the gap a 300 ms guess left, not every gap there is.
	await page.getByLabel('Interpretation').selectOption('balanced');
	await expect(page.getByLabel('Interpretation')).toHaveValue('balanced');

	expect(requestUrls.length).toBe(requestsBeforeSwitch);
});

test('a workspace with no record id in the address bar reports the unnamed outcome', async ({
	page,
}) => {
	await page.goto('/workspace');

	// `components/workspace/workspace-route.tsx` stamps `data-outcome` on the terminal `<main>` for
	// each of the four outcomes it can render outside `found`, since nothing else in the DOM tells
	// them apart without reading the outcome's own prose.
	await expect(page.locator('main[data-outcome="unnamed"]')).toBeVisible();
});

test('a workspace pointed at an id nothing is stored under reports the missing outcome', async ({
	page,
}) => {
	await page.goto(`/workspace?${RECORD_PARAM}=${randomUUID()}`);

	await expect(page.locator('main[data-outcome="missing"]')).toBeVisible();
});

test('a workspace pointed at a row that fails BrandRecordSchema reports the unreadable outcome', async ({
	page,
}) => {
	const id = randomUUID();

	// Written straight into the object store rather than through `seedWorkspaceRecord`, which
	// parses first: this row has to reach `RecordStore.get`'s own `BrandRecordSchema.parse` and
	// fail there. It supplies `revision`, so that's not what trips the schema; `schemaVersion` is a
	// `z.literal(SCHEMA_VERSION)`, and `1` is a version the schema has moved past.
	await writeIndexedDbRow(page, {
		id,
		schemaVersion: 1,
		revision: FIRST_REVISION,
		images: [],
		versions: [],
	});

	await page.goto(`/workspace?${RECORD_PARAM}=${id}`);

	await expect(page.locator('main[data-outcome="unreadable"]')).toBeVisible();
});

test('a workspace that cannot open its database at all reports the unavailable outcome', async ({
	page,
}) => {
	// `WorkspaceRoute` loads the storage module through a dynamic import, then calls
	// `createIndexedDbRecordStore`, which opens at `DATABASE_VERSION`, `1`. Opening the same database
	// at a higher version first, ahead of that call, bumps the version IndexedDB has on record for
	// this origin—a fact storage keeps, not a fact this connection holds. The connection itself does
	// not need to outlive this call, and does not: `page.goto` below replaces the document, which
	// tears down the JS heap this closure ran in along with any object it stashed on `window`, so it
	// is closed here explicitly instead. What survives the navigation is the version number.
	// `createIndexedDbRecordStore`'s own `openDB` call then asks to open at a version lower than the
	// one storage now has on record, which the spec refuses; the refusal is a `VersionError`
	// delivered as an async `error` event on the request, not a synchronous throw, so it rejects
	// `createIndexedDbRecordStore`'s promise instead of throwing into its caller directly, and
	// `WorkspaceRoute`'s outer `catch` is what turns that rejection into `unavailable`.
	await page.evaluate(async (databaseName) => {
		const request = indexedDB.open(databaseName, 2);
		await new Promise<void>((resolve, reject) => {
			request.addEventListener('success', () => resolve());
			request.addEventListener('error', () => reject(request.error));
		});
		request.result.close();
	}, DATABASE_NAME);

	await page.goto(`/workspace?${RECORD_PARAM}=${randomUUID()}`);

	await expect(page.locator('main[data-outcome="unavailable"]')).toBeVisible();
});

test('opening record A then client-navigating to record B shows only B, never a stale frame of A', async ({
	page,
}) => {
	const recordA = buildRecordWithOneVersion();
	const recordB = buildEmptyRecord();

	await seedWorkspaceRecord(page, recordA);
	await seedWorkspaceRecord(page, recordB);

	// Installed before the first navigation, so the wrap is in place for the document that
	// navigation loads: `page.addInitScript` only reaches documents the page loads afterwards, not
	// the one already open from `cleanIndexedDb`'s own navigation.
	await installOpenHold(page, DATABASE_NAME);

	await page.goto(`/workspace?${RECORD_PARAM}=${recordA.id}`);
	await expect(
		page.getByRole('region', { name: 'Tokens' }).getByRole('listitem').first(),
	).toBeVisible();

	// `history.pushState` rather than `page.goto`, because a `goto` is a hard navigation that
	// remounts `WorkspaceRoute` and starts `loaded` over at null, which can never expose the bug:
	// the render guard only matters while `loaded` still holds a previous record's result. Next.js's
	// app router patches `window.history.pushState` for exactly this—see the comment above
	// `patchHistoryMethod` in `next/dist/client/components/app-router.js`—specifically so an
	// external call like this one is picked up as a client-side navigation, `useSearchParams()`
	// included, the same as a same-page `<Link>` click would be.
	//
	// The mutant under test drops the `loaded?.id === recordId` guard to `loaded ? loaded.result :
	// ...`. Losing the id check does not change what the very next render paints—`WorkspaceRoute`'s
	// own re-render still has to reach the DOM before either build can differ. The two diverge from
	// that render on: a correct build has already moved to the loading state, since `loaded.id` (A)
	// no longer matches `recordId` (B), while the mutant keeps painting `loaded.result`—A's
	// already-resolved, still-non-null seed—for as long as record B's own open stays unresolved.
	// Arming the hold and pushing the new URL happen in the one call, so record B's effect (which
	// only runs once `recordId` changes) has no gap in which to slip past an unarmed hold.
	await page.evaluate(
		([param, bId]) => {
			(window as unknown as WindowWithOpenHold).cambiumOpenHold.armed = true;
			history.pushState({}, '', `/workspace?${param}=${bId}`);
		},
		[RECORD_PARAM, recordB.id] as const,
	);

	// Without this, a hold that never caught record B's own open would pass having held nothing —
	// the id guard could be missing entirely and this would still see zero.
	await expect
		.poll(() => page.evaluate(() => (window as unknown as WindowWithOpenHold).cambiumOpenHold.held))
		.toBeGreaterThan(0);

	await expect(page).toHaveURL(new RegExp(`${RECORD_PARAM}=${recordB.id}$`));
	// Held here for as long as this assertion's own retries choose to wait: record B's open cannot
	// resolve until `release` runs below, so a correct build's loading state (no `<dl>` at all) and
	// the mutant's stale render of A (a `<dl>` that never goes away on its own) stay exactly as they
	// are—nothing to race, because nothing changes until the test says so.
	await expect(page.locator('dl')).toHaveCount(0);

	await page.evaluate(() => {
		(window as unknown as WindowWithOpenHold).cambiumOpenHold.release();
	});

	// Record B has no versions, so no seed once it actually settles:
	// `components/workspace/seed-rail.tsx` renders no `<dl>`, the same presence check the
	// landing-link scenario below uses. The rail itself has to be visible too, or this would pass
	// with `WorkspaceRoute` stuck on the loading state forever.
	await expect(page.getByRole('complementary', { name: 'Seed and tokens' })).toBeVisible();
	await expect(page.locator('dl')).toHaveCount(0);
});

test('the raw response sits closed at the bottom of the page, below both columns', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// `components/workspace/raw-response.tsx` renders one `<details>` with no `open` attribute.
	// Located by tag rather than by role: HTML's own accessibility mapping for `<details>` is not a
	// stable enough target, where the `open` DOM property is.
	const details = page.locator('details');
	const rail = page.getByRole('complementary', { name: 'Seed and tokens' });
	const output = page.getByRole('region', { name: 'Output' });

	await expect(details).toBeVisible();
	await expect(details).toHaveJSProperty('open', false);

	// The issue puts it "at the bottom", apart from the rail's two sections, so its top edge has to
	// clear the bottom of both columns at either width. Inside the rail it would start above the
	// rail's bottom edge, and inside the output column above that column's.
	for (const width of [1280, 375]) {
		await page.setViewportSize({ width, height: 900 });

		const detailsBox = await requireBox(details);
		const railBox = await requireBox(rail);
		const outputBox = await requireBox(output);

		expect(detailsBox.y).toBeGreaterThanOrEqual(railBox.y + railBox.height - 1);
		expect(detailsBox.y).toBeGreaterThanOrEqual(outputBox.y + outputBox.height - 1);
	}
});

test('a version with no raw response renders the details element as a paragraph, not a preformatted block', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion({ rawResponse: null });
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const details = page.locator('details');
	await expect(details).toBeVisible();

	// Opened so the branch's own element is actually in the accessibility tree, not merely present
	// in a collapsed `<details>`.
	await details.locator('summary').click();

	// `components/workspace/raw-response.tsx` renders a `<pre>` for a real response and a `<p>` for
	// a null one: the tag, not either branch's wording, is what tells them apart.
	await expect(details.locator('p')).toBeVisible();
	await expect(details.locator('pre')).toHaveCount(0);
});

test('the layout collapses to one column narrow and sits side by side from md up', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const rail = page.getByRole('complementary', { name: 'Seed and tokens' });
	const output = page.getByRole('region', { name: 'Output' });

	await expect(rail).toBeVisible();
	await expect(output).toBeVisible();

	// Below Tailwind's `md` breakpoint (768px), `components/workspace/shell.tsx`'s grid is
	// `grid-cols-1`, so the two boxes stack.
	await page.setViewportSize({ width: 375, height: 900 });
	const narrowRail = await requireBox(rail);
	const narrowOutput = await requireBox(output);

	expect(narrowOutput.y).toBeGreaterThanOrEqual(narrowRail.y + narrowRail.height - 1);

	// At 1280px the grid switches to `md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]`, so the columns
	// sit beside each other: the output box starts at or after the rail's right edge, and the two
	// boxes share vertical space rather than one starting where the other ends.
	await page.setViewportSize({ width: 1280, height: 900 });
	const wideRail = await requireBox(rail);
	const wideOutput = await requireBox(output);

	expect(wideOutput.x).toBeGreaterThanOrEqual(wideRail.x + wideRail.width - 1);
	expect(wideOutput.y).toBeLessThan(wideRail.y + wideRail.height);
	expect(wideRail.y).toBeLessThan(wideOutput.y + wideOutput.height);
});

/** A minimal valid PNG, the same single black pixel `e2e/indexeddb.spec.ts` inlines for the same reason: `prepareReferenceImage` decodes through the browser's real `createImageBitmap`, which only real PNG bytes satisfy. */
const ONE_PIXEL_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('a saved record links to its workspace, which opens reporting no versions yet', async ({
	page,
}) => {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles({
		name: 'brand.png',
		mimeType: 'image/png',
		buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
	});

	// State, not copy: `components/landing/upload-form.tsx` disables the submit button until a
	// picked file has decoded, so waiting on that state is what proves the image landed without
	// reading anything the button says.
	const saveButton = page.getByRole('button', { name: 'Save these references' });
	await expect(saveButton).toBeEnabled();
	await saveButton.click();

	// `components/landing/landing-route.tsx` calls `router.replace` with the saved id once the
	// write's read-back resolves, so the address bar is where "the saved id" comes from, independent
	// of anything the found outcome then renders.
	await expect(page).toHaveURL(new RegExp(`[?&]${RECORD_PARAM}=`));
	const savedId = new URL(page.url()).searchParams.get(RECORD_PARAM);
	if (!savedId) throw new Error('expected a record id in the address bar after saving');

	// Located by its `href`, never by the link's text: Task 3's own decision says browser checks
	// assert where this link points, not what it says.
	const workspaceLink = page.locator(`a[href*="/workspace?${RECORD_PARAM}="]`);
	await expect(workspaceLink).toHaveAttribute('href', new RegExp(`${RECORD_PARAM}=${savedId}$`));

	await workspaceLink.click();

	await expect(page).toHaveURL(new RegExp(`${RECORD_PARAM}=${savedId}$`));

	// Absence alone also passes while `WorkspaceRoute` is still on its loading state, or never
	// resolves at all—nothing below is `<dl>`, a token row, or a `<details>` either. This asserts
	// the shell itself actually mounted for this record before reading what it left out: the rail
	// is the structural marker `components/workspace/shell.tsx` always renders once a record loads,
	// with or without versions.
	await expect(page.getByRole('complementary', { name: 'Seed and tokens' })).toBeVisible();

	// No versions yet: `components/workspace/seed-rail.tsx` renders no `<dl>` when the seed is null,
	// `components/workspace/token-list.tsx` renders no list rows when `derived` is null, and
	// `components/workspace/shell.tsx` renders no `RawResponse` at all when there is no active
	// version. Each is a presence check, not a reading of what any of them say.
	await expect(page.locator('dl')).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Tokens' }).getByRole('listitem')).toHaveCount(0);
	await expect(page.locator('details')).toHaveCount(0);
});
