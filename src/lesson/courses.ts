import { EXERCISES, indexOfExercise, SECTIONS, type Exercise, type Section } from './exercises'

/**
 * What the course page offers.
 *
 * A course is data, so a new one is one more entry here. Only Python has
 * anything behind it: the runner, the observer's code analysis, the error
 * dictionary and the teacher's prompt are all Python's, so a second language is
 * more than a card. The `soon` entries are placeholders that say where this is
 * going; they are shown locked and lead nowhere.
 */
export type Course = {
  id: string
  title: string
  /** Two or three characters for the card's tile. Drawn, not a logo, so the app
   *  still makes no requests off-site. */
  mark: string
  tagline: string
  status: 'available' | 'soon'
  /** In the order they are taught. */
  topics: string[]
  /** Empty for a course that is not built yet. */
  exercises: Exercise[]
}

const SECTION_LABEL: Record<Section, string> = {
  output: 'Output',
  variables: 'Variables',
  strings: 'Strings',
  conditionals: 'Conditions',
  lists: 'Lists',
  loops: 'Loops',
  dicts: 'Dictionaries',
  functions: 'Functions',
}

export const COURSES: Course[] = [
  {
    id: 'python',
    mark: 'Py',
    title: 'Python',
    tagline: 'From your first print to writing your own functions, with a teacher beside you.',
    status: 'available',
    topics: SECTIONS.map((s) => SECTION_LABEL[s]),
    exercises: EXERCISES,
  },
  {
    id: 'javascript',
    mark: 'JS',
    title: 'JavaScript',
    tagline: 'The language of the web, one small program at a time.',
    status: 'soon',
    topics: [],
    exercises: [],
  },
  {
    id: 'html-css',
    mark: '</>',
    title: 'HTML & CSS',
    tagline: 'Build and style your first web page.',
    status: 'soon',
    topics: [],
    exercises: [],
  },
  {
    id: 'sql',
    mark: 'SQL',
    title: 'SQL',
    tagline: 'Ask questions of data and get answers back.',
    status: 'soon',
    topics: [],
    exercises: [],
  },
]

export function courseById(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id)
}

/** How many of a course's exercises are solved. `solved` is the store's, which
 *  is addressed by position in the full ramp, so each exercise is looked up by id. */
export function solvedCount(course: Course, solved: boolean[]): number {
  return course.exercises.filter((e) => solved[indexOfExercise(e.id)]).length
}

/** The first exercise not yet solved, as a position in the full ramp, or null
 *  when there is nothing left (or nothing in the course). */
export function firstUnsolved(course: Course, solved: boolean[]): number | null {
  for (const e of course.exercises) {
    const i = indexOfExercise(e.id)
    if (i >= 0 && !solved[i]) return i
  }
  return null
}
