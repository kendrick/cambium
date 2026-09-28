import { describe, expect, it } from 'vitest';

import { PINNED_SET } from './css/css.fixture';
import { resolveScheme } from './resolve-scheme';
import type { SemanticEntry } from './token-set';

describe('resolveScheme', () => {
	// #121: `resolved[token] = ...` against a plain `{}` repoints the accumulator's own prototype
	// when `token` is "__proto__", instead of storing an own entry, and the token silently
	// disappears from every later `Object.keys`/`Object.entries` read.
	it('keeps a semantic token literally named "__proto__" as an own entry', () => {
		const light = PINNED_SET.schemes.light;
		const [aliasedToken, aliasedEntry] = Object.entries(light.semantic)[0]!;

		// A computed key creates a genuine own data property here, so `JSON.stringify` below has a
		// real "__proto__" key to serialize, and `JSON.parse` rebuilds it the same way a parsed file
		// or a network response would. Two other ways to write this line don't reach that: a literal
		// `__proto__:` key sets the object's own [[Prototype]] by the object-literal grammar itself,
		// and a bracket assignment on an ordinary object invokes the inherited `Object.prototype`
		// accessor and repoints it that way instead—neither leaves an own key to serialize.
		const withOwnProtoKey = { ...light.semantic, ['__proto__']: aliasedEntry };
		const semantic = JSON.parse(JSON.stringify(withOwnProtoKey)) as Record<string, SemanticEntry>;

		expect(Object.hasOwn(semantic, '__proto__')).toBe(true);

		const resolved = resolveScheme({ primitives: light.primitives, semantic });

		expect(Object.keys(resolved)).toHaveLength(Object.keys(semantic).length);
		expect(Object.hasOwn(resolved, '__proto__')).toBe(true);
		expect(resolved['__proto__']).toEqual(resolved[aliasedToken]!);

		// Nothing ordinary regressed: stripped of the added key, the result matches what the
		// untouched fixture resolves to.
		const plain = resolveScheme(light);
		const { __proto__: _dropped, ...rest } = resolved;

		// toEqual compares own enumerable properties, not prototypes, so a null-prototype `rest`
		// and a null-prototype `plain` count equal here on purpose.
		expect(rest).toEqual(plain);
	});
});
