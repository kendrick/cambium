import { Suspense } from 'react';

import { LandingRoute } from '@/components/landing/landing-route';

/**
 * Deliberately still a Server Component. Everything that needs the browser lives in
 * `LandingRoute`, which keeps React's client boundary as small as the route allows and keeps this
 * file free of anything the first-load budget would have to pay for.
 *
 * The Suspense boundary is not optional: `useSearchParams` reads nothing at prerender, and static
 * export refuses to build a page that calls it without one.
 */
const LOADING = <p className="text-muted-foreground text-sm">Loading…</p>;

export default function Home() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-8 p-8">
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-semibold tracking-tight">Cambium</h1>
				<p className="text-muted-foreground">
					Brand reference images in, semantic DTCG design tokens out.
				</p>
			</div>
			<Suspense fallback={LOADING}>
				<LandingRoute />
			</Suspense>
		</main>
	);
}
