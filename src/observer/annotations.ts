import { Annotation } from '@codemirror/state'

/**
 * Marks a transaction the app made on the learner's behalf — swapping in an
 * exercise's starter buffer, for instance. The observer ignores these: a
 * whole-document replacement would otherwise look like an edit touching every
 * line, which is exactly the shape of thrash.
 */
export const programmaticEdit = Annotation.define<boolean>()
