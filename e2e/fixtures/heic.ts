/**
 * `lib/image-intake.ts` never trusts a filename or a `File.type`; it decides format from magic
 * bytes alone (see `sniffImageType`'s docblock there). The defect #105 exists to cover is a HEIC
 * export that iOS or a photo picker has renamed to end in `.png` — the exact shape `describeRejectedBytes`
 * and `sniffImageType` are built to see through. This generator produces that shape without a real
 * HEIC encoder, because only the `ftyp` box header those two functions actually read has to be
 * genuine.
 */

/** ASCII bytes for a fixed-width box field (`ftyp`, a brand, …); no encoding beyond one byte per char. */
function asciiBytes(value: string): Uint8Array {
	return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

/**
 * A minimal ISO base media `ftyp` box: size, `ftyp`, a major brand of `heic` at the offset
 * `lib/image-intake.ts` reads (`:150`-`:152`), a zero minor version, and one compatible-brand slot
 * as padding — present because a real `ftyp` box always carries at least one, not because anything
 * here reads it. Paired with a `.png` name, so the bytes and the extension disagree the way #22's
 * defect did.
 */
export function makeRenamedHeic(): { bytes: Uint8Array; name: string } {
	const box = new Uint8Array(24);
	const view = new DataView(box.buffer);

	view.setUint32(0, box.length);
	box.set(asciiBytes('ftyp'), 4);
	box.set(asciiBytes('heic'), 8);
	view.setUint32(12, 0);
	box.set(asciiBytes('mif1'), 16);
	box.set(asciiBytes('heic'), 20);

	return { bytes: box, name: 'logo.png' };
}
