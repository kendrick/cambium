import { Button } from '@/components/ui/button';

export default function Home() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-6 p-8">
			<h1 className="text-3xl font-semibold tracking-tight">Cambium</h1>
			<p className="text-muted-foreground">
				Brand reference images in, semantic DTCG design tokens out.
			</p>
			{/* Placeholder: proves shadcn renders end to end. The real entry point
			    arrives with the landing ticket. */}
			<Button disabled>Upload a reference image</Button>
		</main>
	);
}
