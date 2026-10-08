import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Sheet } from './Sheet.vue'
export { default as SheetClose } from './SheetClose.vue'
export { default as SheetContent } from './SheetContent.vue'
export { default as SheetDescription } from './SheetDescription.vue'
export { default as SheetHeader } from './SheetHeader.vue'
export { default as SheetTitle } from './SheetTitle.vue'

export const sheetVariants = cva(
  'bg-background fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-open:animate-in data-closed:animate-out data-closed:duration-200 data-open:duration-300',
  {
    variants: {
      side: {
        top: 'data-closed:slide-out-to-top data-open:slide-in-from-top inset-x-0 top-0 h-auto border-b',
        bottom: 'data-closed:slide-out-to-bottom data-open:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
        left: 'data-closed:slide-out-to-left data-open:slide-in-from-left inset-y-0 left-0 h-full w-full max-w-md border-r',
        right: 'data-closed:slide-out-to-right data-open:slide-in-from-right inset-y-0 right-0 h-full w-full max-w-md border-l',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
)
export type SheetVariants = VariantProps<typeof sheetVariants>
