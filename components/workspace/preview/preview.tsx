'use client';

import { type CSSProperties, useCallback, useMemo, useRef, useState } from 'react';

import type { SchemeName } from '../../../core/token-overrides';
import type { TokenSet } from '../../../core/token-set';
import { cssNaming } from '../../../core/css/globals-css';
import { scalarDeclarations, schemeDeclarations } from '../../../core/css/scheme-declarations';
import { Button } from '@/components/ui/button';
import { AppScreen } from '@/components/workspace/preview/app-screen';
import { Gallery } from '@/components/workspace/preview/gallery';

type Declared =
	| { ok: true; style: CSSProperties; scalars: Record<string, string> }
	| { ok: false; reason: string };

function declare(tokenSet: TokenSet, scheme: SchemeName): Declared {
	const naming = cssNaming();

	// These run the stylesheet export's own checks, so a set the export would refuse throws here too.
	// Showing why beats rendering half a theme over the app's defaults as though it were the brand.
	try {
		const scalars = scalarDeclarations(tokenSet, naming);
		const style = { ...schemeDeclarations(tokenSet, scheme, naming), ...scalars };

		return { ok: true, style: style as CSSProperties, scalars };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

export function Preview({ tokenSet }: { tokenSet: TokenSet }) {
	const [scheme, setScheme] = useState<SchemeName>('light');
	const containerRef = useRef<HTMLDivElement>(null);
	const declared = useMemo(() => declare(tokenSet, scheme), [tokenSet, scheme]);
	const toggleScheme = useCallback(
		() => setScheme((current) => (current === 'dark' ? 'light' : 'dark')),
		[],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					Your tokens on a component set and a sample app screen.
				</p>
				<Button variant="outline" size="sm" aria-pressed={scheme === 'dark'} onClick={toggleScheme}>
					Dark scheme
				</Button>
			</div>

			{declared.ok ? (
				// Every map entry goes inline rather than into a class: the `dark` class is here so `dark:`
				// variants apply, but it also pulls in the app's own `.dark` colours, and only an inline
				// declaration is sure to beat that rule on this element.
				<div
					ref={containerRef}
					data-preview
					data-preview-scheme={scheme}
					style={declared.style}
					className={`${scheme === 'dark' ? 'dark ' : ''}bg-background text-foreground min-h-0 flex-1 overflow-y-auto rounded-xl border`}
				>
					<AppScreen />
					<Gallery scalars={declared.scalars} popoverContainer={containerRef} />
				</div>
			) : (
				<div role="alert" className="text-sm">
					<p>This token set can’t be previewed, because the stylesheet export refuses it too:</p>
					<p className="text-muted-foreground mt-1">{declared.reason}</p>
				</div>
			)}
		</div>
	);
}
