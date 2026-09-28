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

		// A computed key writes an own data property without repointing this object's own
		// prototype, so `JSON.stringify` below has a real "__proto__" key to serialize. A literal
		// `__proto__:` key or a bracket assignment on an ordinary object would instead trigger the
		// `Object.prototype` accessor and repoint the *input* object, never reaching `resolveScheme`
		// with an own key to test.
		const withOwnProtoKey = { ...light.semantic, ['__proto__']: aliasedEntry };

		// `JSON.parse` builds "__proto__" the way a parsed file or a network response would: a
		// genuine own data property, the same path #121's own repro takes.
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

		expect(rest).toEqual(plain);
	});
});
