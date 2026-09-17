import type { MisconceptionId } from '../types'

export type HintTier = {
  tier: 1 | 2 | 3 | 4 | 5
  /** Pre-written. Phase 4 adapts the phrasing; it never changes the tier. */
  text: string
  /** Best guess from the starter layout; a detected misconception wins over it. */
  targetLine: number | null
  /** Tier 4+ puts a parallel worked example beside the learner's code. */
  scratch?: string
}

export type Exercise = {
  id: string
  title: string
  prompt: string
  /** Pre-seeded. The learner never types the list — typos in setup code waste
   *  the session on errors that teach nothing. */
  starter: string
  expectedStdout: string
  hints: HintTier[]
  /** Failure modes this exercise actually provokes, and what each one means. */
  watch: { id: MisconceptionId; note: string }[]
}

export const EXERCISES: Exercise[] = [
  {
    id: 'print-each',
    title: 'Print each number',
    prompt:
      'The list `nums` already exists. Print each number in it, one per line.',
    starter: 'nums = [3, 7, 12, 5]\n\n# Your loop goes here.\n',
    expectedStdout: '3\n7\n12\n5',
    hints: [
      {
        tier: 1,
        text: 'You need something that repeats — once for each number in the list. Python has one keyword for that.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3 is where it goes. The line starts with `for`, and it ends with a colon.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'A `for` loop hands you one item at a time: `for <name> in nums:`. The name is yours to pick, and it holds a different number on each pass.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Here is the same shape on a different list. Read it, then write yours.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncolours = ["red", "green", "blue"]\n\nfor c in colours:\n    print(c)\n',
      },
      {
        tier: 5,
        text: 'Type `for n in nums:` on line 3, press Enter, then type `print(n)`. The indent on the second line is what puts it inside the loop.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncolours = ["red", "green", "blue"]\n\nfor c in colours:\n    print(c)\n',
      },
    ],
    watch: [
      { id: 'no-loop', note: 'No loop yet — they may not know the keyword.' },
      {
        id: 'index-value-confusion',
        note: 'Treating the loop variable as a position rather than the value.',
      },
    ],
  },

  {
    id: 'print-doubled',
    title: 'Print each number doubled',
    prompt:
      'Print each number doubled, one per line — 6, 14, 24, 10. The loop is already written.',
    starter: 'nums = [3, 7, 12, 5]\n\nfor n in nums:\n    print(n)\n',
    expectedStdout: '6\n14\n24\n10',
    hints: [
      {
        tier: 1,
        text: 'The loop itself is right. It is what you print that has to change.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 4. Right now it prints the number exactly as it came out of the list.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: '`n` is the number itself, not its position in the list. So you can do arithmetic on `n` directly.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape, doing arithmetic on the loop variable.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nprices = [10, 20, 30]\n\nfor p in prices:\n    print(p + 5)\n',
      },
      {
        tier: 5,
        text: 'Change line 4 to `print(n * 2)`. Type it in yourself — then run it.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nprices = [10, 20, 30]\n\nfor p in prices:\n    print(p + 5)\n',
      },
    ],
    watch: [
      {
        id: 'index-value-confusion',
        note: 'Reaching for `nums[n]` — the classic sign they think n is an index.',
      },
      { id: 'loop-body-outside', note: 'Print left outside the loop; only the last value appears.' },
    ],
  },

  {
    id: 'sum-them',
    title: 'Add them all up',
    prompt:
      'Add all four numbers together and print the total. It should print 27, once.',
    starter: 'nums = [3, 7, 12, 5]\n\nfor n in nums:\n    print(n)\n',
    expectedStdout: '27',
    hints: [
      {
        tier: 1,
        text: 'You need somewhere to keep the running total. Look at what happens before the loop starts.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Two things change: a new line above line 3, and what line 4 does. The printing moves to the end.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'A variable created inside the loop is created again on every pass — so it gets reset each time. The total has to exist once, before the loop begins.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'This is the same running total on a different list. Notice where each of the three lines sits.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\nscores = [2, 4, 6]\n\ntotal = 0            # created once, before the loop\nfor s in scores:\n    total = total + s  # updated on every pass\nprint(total)         # printed after the loop ends\n',
      },
      {
        tier: 5,
        text: 'Above the loop type `total = 0`. Replace line 4 with `total = total + n`. Then, not indented, type `print(total)` at the bottom. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\nscores = [2, 4, 6]\n\ntotal = 0            # created once, before the loop\nfor s in scores:\n    total = total + s  # updated on every pass\nprint(total)         # printed after the loop ends\n',
      },
    ],
    watch: [
      {
        id: 'accumulator-init-inside-loop',
        note: 'Total reset on every pass. Runs clean, prints the last number — the single most important case here.',
      },
      {
        id: 'accumulator-reassigned',
        note: '`total = n` rather than `total = total + n`: replacing instead of accumulating.',
      },
      {
        id: 'accumulator-printed-inside-loop',
        note: 'Prints four times instead of once — the print is inside the loop.',
      },
      { id: 'loop-body-outside', note: 'Accumulation left outside the loop.' },
    ],
  },

  {
    id: 'count-above-ten',
    title: 'Count the big ones',
    prompt:
      'Count how many numbers in `nums` are greater than 10, and print that count. It should print 3.',
    starter:
      'nums = [3, 7, 12, 5, 18, 9, 21, 4]\n\nfor n in nums:\n    print(n)\n',
    expectedStdout: '3',
    hints: [
      {
        tier: 1,
        text: 'This is the running total from last time, plus a decision. What has to be true about a number before it counts?',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'You need an `if` inside the loop, and the counting line goes inside that `if` — indented one step further.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: 'You are counting how many, not adding them up. Each match should push the counter up by one — it should not add the number itself.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape — counting only the items that match a condition.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nwords = ["hi", "hello", "hey", "greetings"]\n\ncount = 0\nfor w in words:\n    if len(w) > 3:\n        count = count + 1\nprint(count)\n',
      },
      {
        tier: 5,
        text: 'Above the loop type `count = 0`. Replace line 4 with `if n > 10:` and, indented under it, `count = count + 1`. Then `print(count)` at the bottom, not indented.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nwords = ["hi", "hello", "hey", "greetings"]\n\ncount = 0\nfor w in words:\n    if len(w) > 3:\n        count = count + 1\nprint(count)\n',
      },
    ],
    watch: [
      {
        id: 'accumulator-init-inside-loop',
        note: 'Counter reset on every pass; prints 1 or 0.',
      },
      {
        id: 'accumulator-printed-inside-loop',
        note: 'Prints a running count on every pass instead of one number at the end.',
      },
      {
        id: 'accumulator-reassigned',
        note: 'Adding the number rather than 1 — summing when they meant to count.',
      },
    ],
  },
]

/** Trailing blanks and line-end whitespace are not the lesson. */
export function normaliseOutput(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n+$/, '')
    .trim()
}

export function isCorrect(stdout: string, exercise: Exercise): boolean {
  return normaliseOutput(stdout) === normaliseOutput(exercise.expectedStdout)
}
