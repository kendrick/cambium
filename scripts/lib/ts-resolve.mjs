/**
 * Node strips TypeScript types on its own since 23.6, but it still resolves imports the way the
 * ESM spec says to, which means an extensionless `./oklch` is a miss. The core is written for a
 * bundler and uses extensionless relative imports everywhere, so a dev script that wants to call
 * into it needs this rather than a sweep adding `.ts` to every import in `core/`.
 *
 * Dev tooling only. Nothing the browser loads goes through it.
 */
export async function resolve(specifier, context, next) {
	try {
		return await next(specifier, context);
	} catch (error) {
		if (!specifier.startsWith('.')) throw error;

		return next(`${specifier}.ts`, context);
	}
}
