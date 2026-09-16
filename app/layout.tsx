import type { Metadata } from 'next';

import './globals.css';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
	title: 'Cambium',
	description:
		'Turn a reference image into an accessible, semantic design token set in W3C DTCG format.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={cn('font-sans', inter.variable)}>
			<body>{children}</body>
		</html>
	);
}
