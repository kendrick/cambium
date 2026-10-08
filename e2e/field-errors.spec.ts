import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

type AxField = { description: string; invalid: string | undefined };

/**
 * The field as Chromium's accessibility tree hands it to a screen reader, found there by role and
 * name. Playwright 1.63 has no `page.accessibility`, and its aria snapshot carries `invalid` but no
 * description, so this asks the browser's own tree over Playwright's CDP session. `aria-describedby`
 * would only say where a description might come from, and Playwright's own accname code is a
 * re-implementation, not the tree assistive tech reads.
 */
async function axField(page: Page, name: string): Promise<AxField> {
	const cdp = await page.context().newCDPSession(page);
	try {
		const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
		const { nodes } = await cdp.send('Accessibility.queryAXTree', {
			objectId: result.objectId,
			accessibleName: name,
			role: 'spinbutton',
		});
		if (nodes.length !== 1) {
			throw new Error(`expected one spinbutton named "${name}", found ${nodes.length}`);
		}
		const [node] = nodes;
		return {
			description: String(node!.description?.value ?? ''),
			invalid: node!.properties?.find((property) => property.name === 'invalid')?.value.value as
				| string
				| undefined,
		};
	} finally {
		await cdp.detach();
	}
}

/**
 * Before and after one refused edit: the field isn't invalid first, so a check that always read
 * `true` would fail here, and afterwards it's invalid in the attribute the criterion names and in
 * the tree, with the message in its description.
 */
async function expectRefusalAnnounced(
	page: Page,
	field: Locator,
	name: string,
	refused: string,
	message: () => Promise<string>,
): Promise<void> {
	expect((await axField(page, name)).invalid, `${name} before`).not.toBe('true');

	await field.fill(refused);
	await field.blur();

	const shown = await message();
	expect(shown.trim().length, `${name} shows a message`).toBeGreaterThan(0);
	await expect(field).toHaveAttribute('aria-invalid', 'true');
	await expect
		.poll(async () => (await axField(page, name)).invalid, { message: name })
		.toBe('true');
	expect((await axField(page, name)).description, `${name} description`).toContain(shown.trim());
}

function editTrigger(page: Page, id: string): Locator {
	const escaped = id.replaceAll('.', '\\.');
	return page.getByRole('button', { name: new RegExp(`^Edit ${escaped}( \\(has issues\\))?$`) });
}

async function openEditor(page: Page, id: string): Promise<Locator> {
	await editTrigger(page, id).click();
	const editor = page.locator(`[data-editor="${id}"]`);
	await expect(editor).toBeVisible();
	return editor;
}

test('a refused lightness, key colour and value-row field is invalid and described by its message', async ({
	page,
}) => {
	await serveFontTable(page);
	await saveOneRecord(page);
	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);
	await expect(page).toHaveURL(/\/workspace\?record=/);

	// Key colour: the editor's own bound, worded in the issue.
	await page.getByRole('button', { name: 'Edit brand key colour' }).click();
	const keyLightness = page.getByLabel('brand key colour lightness value', { exact: true });
	await expectRefusalAnnounced(
		page,
		keyLightness,
		'brand key colour lightness value',
		'4',
		async () => {
			await expect(page.getByText('Lightness runs 0 to 1.', { exact: true })).toBeVisible();
			return 'Lightness runs 0 to 1.';
		},
	);
	await page.keyboard.press('Escape');

	// Token list lightness: the store refuses it, so the expected message is whatever the editor
	// shows for it.
	const primitive = await openEditor(page, 'primitive.brand.1');
	await expectRefusalAnnounced(
		page,
		primitive.getByLabel('primitive.brand.1 l', { exact: true }),
		'primitive.brand.1 l',
		'2',
		async () => {
			await expect(primitive.locator('[data-issues] li')).toHaveCount(1);
			return (await primitive.locator('[data-issues] li').textContent()) ?? '';
		},
	);
	await page.keyboard.press('Escape');
	await expect(primitive).toHaveCount(0);

	// Token list value row: a shadow leaf, refused the same way.
	const tokens = page.getByRole('region', { name: 'Tokens' });
	await tokens.getByRole('button', { name: 'shadow', exact: true }).click();
	const shadow = await openEditor(page, 'shadow.xs');
	await expectRefusalAnnounced(
		page,
		shadow.getByLabel('shadow.xs color.l', { exact: true }),
		'shadow.xs color.l',
		'2',
		async () => {
			await expect(shadow.locator('[data-issues] li')).toHaveCount(1);
			return (await shadow.locator('[data-issues] li').textContent()) ?? '';
		},
	);
});
