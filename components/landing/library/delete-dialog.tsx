import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogTitle,
} from '@/components/ui/dialog';

/** `label` is null for a row this version can't parse, which has no name to show. */
export function DeleteDialog({
	label,
	open,
	onOpenChange,
	onConfirm,
}: {
	label: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogPopup>
				<div className="flex flex-col gap-4">
					<DialogTitle>{label === null ? 'Delete this brand?' : `Delete ${label}?`}</DialogTitle>
					<DialogDescription>
						{label === null
							? "This version of Cambium can't open this brand. Deleting it removes it from this browser for good."
							: "This removes the brand, its reference images and every version from this browser. It can't be undone."}
					</DialogDescription>
					<div className="flex justify-end gap-2">
						<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
						<Button onClick={onConfirm} type="button" variant="destructive">
							Delete brand
						</Button>
					</div>
				</div>
			</DialogPopup>
		</Dialog>
	);
}
