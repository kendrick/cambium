import type { TokenSet } from '../token-set';
import { type CssNamingOptions, cssNaming, toGlobalsCss } from './globals-css';
import { toDarkThemeLayer, toThemeBlock } from './theme-block';

/**
 * The declaration that makes `.dark` mean anything.
 *
 * Tailwind's stock `dark` variant compiles to `@media (prefers-color-scheme: dark)`. The scheme
 * rules this file emits are keyed to a class instead, because a generated theme is something a
 * reader switches, so without this line every `dark:` utility in the consuming project would key
 * off the operating system while the page read its colours off the class. Nothing would error: the
 * page would simply paint the wrong scheme's colours for one of the two states.
 *
 * `app/globals.css` carries the same declaration, which is why a shadcn project already has it and
 * a second copy costs nothing. A project that does not is the case this exists for.
 */
const DARK_VARIANT = '@custom-variant dark (&:is(.dark *));';

/**
 * A token set as the whole stylesheet a project pastes into its `globals.css`: the dark variant,
 * the `@theme inline` block that registers Tailwind's namespaces, the `:root` and `.dark` rules
 * that hold the values, and a `.dark` rule in `@layer theme` that makes a nested `.dark` reach the
 * theme entries too.
 *
 * This is the entry point. `toGlobalsCss` and `toThemeBlock` are two halves of one file and only
 * work as a pair — every entry in the theme block is a `var()` pointing at a property the scheme
 * rules declare — and a pair built at two different prefixes parses cleanly and compiles cleanly.
 * The semantic utilities still work, `bg-background` among them, because semantic properties carry
 * no prefix. Every prefixed one goes without a value: `rounded-lg`, `shadow-md` and `bg-brand-500`
 * all read a property the other half never declared, which makes the declaration invalid at
 * computed-value time, and CSS reports that nowhere. Reading `prefix` once here and handing the one
 * `CssNaming` to both halves is what keeps that from being a thing a caller can do by accident;
 * neither half defaults its naming, so obtaining a mismatched pair now takes two `cssNaming` calls
 * carrying two different prefixes, written out where a reader can see them.
 *
 * The order is `app/globals.css`'s: variant, theme block, then the scheme rules. It is the order a
 * reader of a hand-maintained shadcn stylesheet already knows, and `@theme inline` entries resolve
 * against whatever the cascade settles on rather than against what precedes them, so the layout is
 * for the reader rather than for the compiler. The layered `.dark` rule comes last because it has
 * no counterpart in `app/globals.css`, and it's the part a reader is least likely to be looking for.
 *
 * That layered rule is what shadcn's own `globals.css` lacks. Without it, an arbitrary value naming
 * a theme entry, such as `bg-[var(--color-brand-500)]` or `shadow-[var(--shadow-md)]`, keeps its
 * light value inside a nested `.dark` while the named utility beside it turns dark.
 * `toDarkThemeLayer` (`core/css/theme-block.ts`) says why, and `e2e/stylesheet-dark.spec.ts`
 * measures it.
 *
 * Declarations follow each record's insertion order, so two sets holding the same tokens in a
 * different key order emit different bytes. That order is the scale's own (`xs` before `sm` before
 * `base`, `tighter` through `wider`, shadcn's semantic order), and a canonical sort would scramble
 * it for the person reading the pasted file. The generator writes each record in a fixed order and
 * JavaScript keeps non-numeric string keys in insertion order, so regenerating a set gives the same
 * bytes. Two sets built by hand in different orders do not.
 *
 * No `@import "tailwindcss"`. What this returns is pasted into a project's own `globals.css`, which
 * is the file that already imports Tailwind; emitting one here would put the consuming project's
 * import somewhere the consumer did not write it.
 *
 * Pure in the sense `serializeDtcg` (`core/dtcg/serialize.ts`) states the contract: same token set
 * in, same bytes out, key order included as above. Nothing here reads the DOM, the network,
 * storage or module state, and the token set is read and never written.
 */
export function toStylesheet(tokenSet: TokenSet, options: CssNamingOptions = {}): string {
	const naming = cssNaming(options);

	return `${DARK_VARIANT}\n\n${toThemeBlock(tokenSet, naming)}\n${toGlobalsCss(tokenSet, naming)}\n${toDarkThemeLayer(tokenSet, naming)}`;
}
