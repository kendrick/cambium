/**
 * culori 4.0.2 publishes no TypeScript declarations for any of its entry points, and no
 * `@types/culori` is installed. Declaring the surface Cambium actually uses keeps the dependency
 * count where ADR-0002 left it and doubles as a list of what the registration in `core/oklch.ts`
 * has to cover: a function added here without its mode registered there fails at runtime.
 *
 * Deliberately narrow. Widen it when a call site needs more, rather than reaching for the barrel
 * types, which would describe an API surface ADR-0003 forbids importing.
 */
declare module 'culori/fn' {
	export type CuloriColor = {
		mode: string;
		l?: number;
		c?: number;
		h?: number;
		r?: number;
		g?: number;
		b?: number;
		alpha?: number;
	};

	type Mode = { mode: string };

	export const modeRgb: Mode;
	export const modeLrgb: Mode;
	export const modeOklch: Mode;
	export const modeP3: Mode;

	export function useMode(mode: Mode): (color: string | CuloriColor) => CuloriColor | undefined;
	export function converter(mode: string): (color: string | CuloriColor) => CuloriColor | undefined;
	export function inGamut(mode: string): (color: string | CuloriColor) => boolean;
	export function toGamut(
		destination: string,
		mode?: string,
	): (color: string | CuloriColor) => CuloriColor;
	export function wcagContrast(a: string | CuloriColor, b: string | CuloriColor): number;
}
