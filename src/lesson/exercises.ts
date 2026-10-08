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

export type Section =
  | 'output'
  | 'variables'
  | 'strings'
  | 'conditionals'
  | 'lists'
  | 'loops'
  | 'dicts'
  | 'functions'

export const SECTIONS: Section[] = [
  'output',
  'variables',
  'strings',
  'conditionals',
  'lists',
  'loops',
  'dicts',
  'functions',
]

export type Exercise = {
  id: string
  title: string
  /** Which part of the ramp this belongs to. The learner profile groups by it. */
  section: Section
  /** What this exercise is about, at the level of the topic. Goes into the
   *  teacher's prompt on every call, so it names the idea and never describes
   *  the mechanics — that is what the hint ladder is for. */
  concept: string
  prompt: string
  /** Pre-seeded. The learner never types the list — typos in setup code waste
   *  the session on errors that teach nothing. */
  starter: string
  expectedStdout: string
  hints: HintTier[]
  /** Failure modes this exercise actually provokes, and what each one means.
   *  Also the filter: a detector firing outside this list is noise here, not a
   *  misconception. `no-loop` is true of every exercise before the loops
   *  section, and saying so would be worse than silence. */
  watch: { id: MisconceptionId; note: string }[]
}

/** Shared by the two string-method exercises; tier 4 and tier 5 reuse one. */
const SCRATCH_METHOD =
  '# Same shape, different problem\ngreeting = "hello there"\n\nprint(greeting.title())\n'

export const EXERCISES: Exercise[] = [
  // ------------------------------------------------------- output (1-2)
  {
    id: 'say-hello',
    title: 'Say hello',
    section: 'output',
    concept: 'printing text to the screen, and text written in quotes',
    prompt: 'Make the program print exactly `Hello, world!` on one line.',
    starter: '# Print the greeting on the line below.\n',
    expectedStdout: 'Hello, world!',
    hints: [
      {
        tier: 1,
        text: 'Python has one built-in way to put text on the screen. It takes what you want shown, in brackets, with the text in quotes.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 2 is where it goes. The word you want is `print`, and the greeting belongs inside the brackets after it.',
        targetLine: 2,
      },
      {
        tier: 3,
        text: 'Text has to be wrapped in quotes, or Python reads it as the name of a variable and complains that no such thing exists. The comma and the exclamation mark are part of the text, so they sit inside the quotes too.',
        targetLine: 2,
      },
      {
        tier: 4,
        text: 'Here is the same shape with different words. Read it, then write yours.',
        targetLine: 2,
        scratch: '# Same shape, different words\nprint("Good morning!")\n',
      },
      {
        tier: 5,
        text: 'On line 2, type `print("Hello, world!")`. The quotes, the comma and the exclamation mark are all part of it. Type it yourself.',
        targetLine: 2,
        scratch: '# Same shape, different words\nprint("Good morning!")\n',
      },
    ],
    watch: [],
  },

  {
    id: 'two-lines',
    title: 'Two lines',
    section: 'output',
    concept: 'a program running its statements top to bottom, in order',
    prompt: 'Print `Hello` on one line and `Goodbye` on the next.',
    starter: '# Print two lines, one after the other.\n',
    expectedStdout: 'Hello\nGoodbye',
    hints: [
      {
        tier: 1,
        text: 'One statement puts one line on the screen. You want two lines, so you need two statements.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Lines 2 and 3. Each is a complete statement of its own, sitting hard against the left margin with nothing indented.',
        targetLine: 2,
      },
      {
        tier: 3,
        text: 'Python runs a file from the top down, one statement at a time. Whatever order you write them in is the order they appear on screen.',
        targetLine: 2,
      },
      {
        tier: 4,
        text: 'Same shape, different words.',
        targetLine: 2,
        scratch: '# Same shape, different words\nprint("Yes")\nprint("No")\n',
      },
      {
        tier: 5,
        text: 'On line 2 type `print("Hello")`. On line 3 type `print("Goodbye")`. Type them yourself.',
        targetLine: 2,
        scratch: '# Same shape, different words\nprint("Yes")\nprint("No")\n',
      },
    ],
    watch: [],
  },

  // ---------------------------------------------- variables and maths (3-6)
  {
    id: 'greet-by-name',
    title: 'Greet by name',
    section: 'variables',
    concept: 'using a stored value inside a piece of text',
    prompt:
      'The variable `name` already holds `Ada`. Print `Hello, Ada!`, but take the name from the variable rather than typing it again.',
    starter: 'name = "Ada"\n\n# Print the greeting here.\n',
    expectedStdout: 'Hello, Ada!',
    hints: [
      {
        tier: 1,
        text: 'The name is already stored. What you want is to join some fixed text onto whatever that variable is holding.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. You are building one piece of text out of several parts: the greeting you type, and the variable.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'A name written without quotes stands for its contents; the same name inside quotes is just those four letters. Joining text together uses the same `+` that adds numbers.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, joining fixed text onto a stored value.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncity = "Paris"\n\nprint("Welcome to " + city + "!")\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `print("Hello, " + name + "!")`. Mind the space after the comma. It lives inside the quotes. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncity = "Paris"\n\nprint("Welcome to " + city + "!")\n',
      },
    ],
    watch: [],
  },

  {
    id: 'add-two',
    title: 'Add two numbers',
    section: 'variables',
    concept: 'arithmetic on stored numbers',
    prompt: '`a` and `b` already hold numbers. Print what they come to together. It should print 42.',
    starter: 'a = 12\nb = 30\n\n# Print the sum here.\n',
    expectedStdout: '42',
    hints: [
      {
        tier: 1,
        text: 'Both numbers are already stored. All that is left is to show what they come to when combined.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 4. The two variable names go inside the brackets with the arithmetic between them.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: 'You can do arithmetic inside the brackets. Python works the value out first and prints the result. There is no need for a third variable to hold it on the way.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape, adding two stored numbers.',
        targetLine: 4,
        scratch: '# Same shape, different problem\nx = 5\ny = 8\n\nprint(x + y)\n',
      },
      {
        tier: 5,
        text: 'On line 4 type `print(a + b)`. Type it yourself.',
        targetLine: 4,
        scratch: '# Same shape, different problem\nx = 5\ny = 8\n\nprint(x + y)\n',
      },
    ],
    watch: [],
  },

  {
    id: 'rectangle-area',
    title: 'Area of a rectangle',
    section: 'variables',
    concept: 'multiplying stored numbers',
    prompt: '`width` and `height` are already set. Print the area. It should print 42.',
    starter: 'width = 7\nheight = 6\n\n# Print the area here.\n',
    expectedStdout: '42',
    hints: [
      {
        tier: 1,
        text: 'The area of a rectangle is its two sides multiplied together. Both sides are already stored for you.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 4. The same shape as adding two numbers, with a different operator sitting between them.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: 'Python multiplies with `*`. It does not use `x`, which would be read as the name of a variable, and there is no variable by that name here.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape, multiplying two stored numbers.',
        targetLine: 4,
        scratch: '# Same shape, different problem\nrows = 4\nseats = 9\n\nprint(rows * seats)\n',
      },
      {
        tier: 5,
        text: 'On line 4 type `print(width * height)`. Type it yourself.',
        targetLine: 4,
        scratch: '# Same shape, different problem\nrows = 4\nseats = 9\n\nprint(rows * seats)\n',
      },
    ],
    watch: [],
  },

  {
    id: 'average-three',
    title: 'The average',
    section: 'variables',
    concept: 'order of operations, and division giving a decimal',
    prompt: 'Three numbers are stored. Print their average. It should print 15.0.',
    starter: 'a = 10\nb = 15\nc = 20\n\n# Print the average here.\n',
    expectedStdout: '15.0',
    hints: [
      {
        tier: 1,
        text: 'An average is everything added up, then shared out between however many there were.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 5. Two operations happen here, and the order they happen in changes the answer.',
        targetLine: 5,
      },
      {
        tier: 3,
        text: 'Python divides before it adds unless you say otherwise, so the three numbers have to be bracketed together before the division can see them. Dividing with `/` always gives a decimal, which is why the answer ends in a zero after a point.',
        targetLine: 5,
      },
      {
        tier: 4,
        text: 'Same shape: bracket the sum, then divide it.',
        targetLine: 5,
        scratch:
          '# Same shape, different problem\np = 2\nq = 4\nr = 9\n\nprint((p + q + r) / 3)\n',
      },
      {
        tier: 5,
        text: 'On line 5 type `print((a + b + c) / 3)`. The outer brackets belong to print; the inner pair forces the adding to happen first. Type it yourself.',
        targetLine: 5,
        scratch:
          '# Same shape, different problem\np = 2\nq = 4\nr = 9\n\nprint((p + q + r) / 3)\n',
      },
    ],
    watch: [],
  },

  // -------------------------------------------------------- strings (7-9)
  {
    id: 'shout-it',
    title: 'Shout it',
    section: 'strings',
    concept: 'string methods, called with a dot',
    prompt: '`word` holds `python`. Print it in capitals: `PYTHON`.',
    starter: 'word = "python"\n\n# Print it in capitals here.\n',
    expectedStdout: 'PYTHON',
    hints: [
      {
        tier: 1,
        text: 'You do not have to retype the word in capitals. Strings know how to do this to themselves.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. The variable comes first, then a dot, then the thing you are asking it to do.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'Strings carry built-in operations called methods. You reach one by writing the string, a dot, the method name, and a pair of brackets after it. The one you want hands back an all-capitals copy and leaves the original alone.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, calling a method on a string.',
        targetLine: 3,
        scratch: SCRATCH_METHOD,
      },
      {
        tier: 5,
        text: 'On line 3 type `print(word.upper())`. The empty brackets at the end are what actually runs it. Type it yourself.',
        targetLine: 3,
        scratch: SCRATCH_METHOD,
      },
    ],
    watch: [],
  },

  {
    id: 'full-name',
    title: 'The full name',
    section: 'strings',
    concept: 'joining pieces of text together',
    prompt:
      '`first` and `last` are already set. Print `Ada Lovelace` on one line, with a single space between the two.',
    starter: 'first = "Ada"\nlast = "Lovelace"\n\n# Print the full name here.\n',
    expectedStdout: 'Ada Lovelace',
    hints: [
      {
        tier: 1,
        text: 'Both halves are stored. The space between them is not, so that part is yours to supply.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 4. Three pieces joined into one: the first variable, something in the middle, the second variable.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: 'A space is an ordinary character like any other, so it has to be written as text in quotes. Leave it out and the two names run together with nothing between them.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape, three pieces joined with a separator in the middle.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nday = "Monday"\nmonth = "June"\n\nprint(day + " in " + month)\n',
      },
      {
        tier: 5,
        text: 'On line 4 type `print(first + " " + last)`. The middle piece is a pair of quotes with one space inside them. Type it yourself.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nday = "Monday"\nmonth = "June"\n\nprint(day + " in " + month)\n',
      },
    ],
    watch: [],
  },

  {
    id: 'how-long',
    title: 'How long is it?',
    section: 'strings',
    concept: 'measuring length with a built-in, and one call inside another',
    prompt: '`word` holds `elephant`. Print how many letters it has. It should print 8.',
    starter: 'word = "elephant"\n\n# Print the number of letters here.\n',
    expectedStdout: '8',
    hints: [
      {
        tier: 1,
        text: 'Do not count them by hand. Python has a built-in that measures how long something is.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. Two things happen here, measuring and printing, and one of them sits inside the other.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'The measuring built-in takes the thing being measured in its brackets and hands back a number. That number is what gets printed, so one pair of brackets ends up nested inside the other.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape: one built-in feeding its result straight into another.',
        targetLine: 3,
        scratch: '# Same shape, different problem\ncity = "Lisbon"\n\nprint(len(city))\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `print(len(word))`. The inner brackets hold what is being measured; the outer ones belong to print. Type it yourself.',
        targetLine: 3,
        scratch: '# Same shape, different problem\ncity = "Lisbon"\n\nprint(len(city))\n',
      },
    ],
    watch: [],
  },

  // --------------------------------------------------- conditionals (10-12)
  {
    id: 'is-it-big',
    title: 'Is it big?',
    section: 'conditionals',
    concept: 'choosing between two outcomes with if and else',
    prompt: '`number` holds 42. Print `big` if it is more than ten, and `small` if it is not.',
    starter: 'number = 42\n\n# Your if statement goes here.\n',
    expectedStdout: 'big',
    hints: [
      {
        tier: 1,
        text: 'The program has to choose between two different outputs. Python has a keyword for asking a question like that.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3 asks the question and ends with a colon. What happens when the answer is yes goes on the next line, indented underneath.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'An `if` runs its indented block only when the test holds. `else:`, written at the same level as the `if`, catches every other case and has an indented block of its own.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, choosing between two outputs.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ntemperature = 5\n\nif temperature > 20:\n    print("warm")\nelse:\n    print("cold")\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `if number > 10:`, press Enter and type `print("big")` indented. Then back at the left margin type `else:`, press Enter, and type `print("small")` indented. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ntemperature = 5\n\nif temperature > 20:\n    print("warm")\nelse:\n    print("cold")\n',
      },
    ],
    watch: [],
  },

  {
    id: 'pass-or-fail',
    title: 'Pass or fail',
    section: 'conditionals',
    concept: 'comparisons, and whether a boundary value is included',
    prompt: '`score` holds 55. Print `pass` if the score is sixty or more, and `fail` otherwise.',
    starter: 'score = 55\n\n# Your if statement goes here.\n',
    expectedStdout: 'fail',
    hints: [
      {
        tier: 1,
        text: 'The same shape as the last one, but read the threshold carefully. "Sixty or more" has to include sixty itself.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. The comparison needs two characters rather than one, so that a score sitting exactly on the threshold still counts.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'Python writes "greater than or equal to" as two characters side by side, the angle bracket first. With a plain `>` a score sitting exactly on the threshold would fail, which is not what was asked for.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, with a threshold that includes its own boundary.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\nage = 17\n\nif age >= 18:\n    print("adult")\nelse:\n    print("minor")\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `if score >= 60:`, press Enter, then `print("pass")` indented. Then `else:` at the left margin, Enter, and `print("fail")` indented. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\nage = 17\n\nif age >= 18:\n    print("adult")\nelse:\n    print("minor")\n',
      },
    ],
    watch: [],
  },

  {
    id: 'grade-it',
    title: 'Grade it',
    section: 'conditionals',
    concept: 'more than two outcomes, checked in order',
    prompt:
      '`score` holds 74. Print `A` for ninety and above, `B` for seventy to eighty-nine, and `C` for anything lower.',
    starter: 'score = 74\n\n# Your if statement goes here.\n',
    expectedStdout: 'B',
    hints: [
      {
        tier: 1,
        text: 'Three outcomes this time rather than two. You need a middle branch sitting between the first test and the catch-all.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. The first test, then a second test for the middle band, then the catch-all at the bottom.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'Python checks the branches from the top down and stops at the first one that holds. That is why the middle band only has to rule out its own lower edge, because anything higher was already caught by the branch above it.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, three bands checked in order.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\nspeed = 45\n\nif speed > 70:\n    print("fast")\nelif speed > 30:\n    print("steady")\nelse:\n    print("slow")\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `if score >= 90:` with `print("A")` indented under it. Then `elif score >= 70:` with `print("B")` under that, and finally `else:` with `print("C")`. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\nspeed = 45\n\nif speed > 70:\n    print("fast")\nelif speed > 30:\n    print("steady")\nelse:\n    print("slow")\n',
      },
    ],
    watch: [],
  },

  // ----------------------------------------------------------- lists (13-14)
  {
    id: 'first-and-last',
    title: 'First and last',
    section: 'lists',
    concept: 'picking items out of a list by position',
    prompt: 'Print the first number in `nums`, then the last. Two lines: 3, then 5.',
    starter: 'nums = [3, 7, 12, 5]\n\n# Print the first, then the last.\n',
    expectedStdout: '3\n5',
    hints: [
      {
        tier: 1,
        text: 'You can reach into a list for one item at a time. There is a way of saying which one you want.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Lines 3 and 4. Square brackets written straight after the list name pick out a single item.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'Python counts list positions from zero, so the first item is at position zero rather than one. Counting backwards works too: negative positions are measured from the end.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, picking the two ends out of a list.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ndays = ["Mon", "Tue", "Wed", "Thu"]\n\nprint(days[0])\nprint(days[-1])\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `print(nums[0])`, and on line 4 type `print(nums[-1])`. Type them yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ndays = ["Mon", "Tue", "Wed", "Thu"]\n\nprint(days[0])\nprint(days[-1])\n',
      },
    ],
    watch: [],
  },

  {
    id: 'how-many',
    title: 'How many numbers?',
    section: 'lists',
    concept: 'measuring how many items a list holds',
    prompt: 'Print how many numbers are in `nums`. It should print 6.',
    starter: 'nums = [3, 7, 12, 5, 18, 9]\n\n# Print how many there are.\n',
    expectedStdout: '6',
    hints: [
      {
        tier: 1,
        text: 'The same built-in that measured a word will measure a list. Do not count them by hand.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. Measure the list, print the result: one call nested inside the other, exactly as before.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'Length means something slightly different depending on what you hand it: for a word it counts letters, for a list it counts items. The call looks identical either way.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape as measuring a word, pointed at a list instead.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncolours = ["red", "green", "blue"]\n\nprint(len(colours))\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `print(len(nums))`. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncolours = ["red", "green", "blue"]\n\nprint(len(colours))\n',
      },
    ],
    watch: [],
  },

  // ------------------------------------------- loops and accumulators (15-18)
  {
    id: 'print-each',
    title: 'Print each number',
    section: 'loops',
    concept: 'repeating something once per item in a list',
    prompt:
      'The list `nums` already exists. Print each number in it, one per line.',
    starter: 'nums = [3, 7, 12, 5]\n\n# Your loop goes here.\n',
    expectedStdout: '3\n7\n12\n5',
    hints: [
      {
        tier: 1,
        text: 'You need something that repeats, once for each number in the list. Python has one keyword for that.',
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
      { id: 'no-loop', note: 'No loop yet. They may not know the keyword.' },
      {
        id: 'index-value-confusion',
        note: 'Treating the loop variable as a position rather than the value.',
      },
    ],
  },

  {
    id: 'print-doubled',
    title: 'Print each number doubled',
    section: 'loops',
    concept: 'using the loop variable as the value itself',
    prompt:
      'Print each number doubled, one per line: 6, 14, 24, 10. The loop is already written.',
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
        text: 'Change line 4 to `print(n * 2)`. Type it in yourself, then run it.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\nprices = [10, 20, 30]\n\nfor p in prices:\n    print(p + 5)\n',
      },
    ],
    watch: [
      {
        id: 'index-value-confusion',
        note: 'Reaching for `nums[n]`, the classic sign they think n is an index.',
      },
      { id: 'loop-body-outside', note: 'Print left outside the loop; only the last value appears.' },
    ],
  },

  {
    id: 'sum-them',
    title: 'Add them all up',
    section: 'loops',
    concept: 'building up a running total across a loop',
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
        text: 'A variable created inside the loop is created again on every pass, so it gets reset each time. The total has to exist once, before the loop begins.',
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
        note: 'Total reset on every pass. Runs clean, prints the last number. This is the single most important case here.',
      },
      {
        id: 'accumulator-reassigned',
        note: '`total = n` rather than `total = total + n`: replacing instead of accumulating.',
      },
      {
        id: 'accumulator-printed-inside-loop',
        note: 'Prints four times instead of once because the print is inside the loop.',
      },
      { id: 'loop-body-outside', note: 'Accumulation left outside the loop.' },
    ],
  },

  {
    id: 'count-above-ten',
    title: 'Count the big ones',
    section: 'loops',
    concept: 'counting only the items that meet a condition',
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
        text: 'You need an `if` inside the loop, and the counting line goes inside that `if`, indented one step further.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: 'You are counting how many, not adding them up. Each match should push the counter up by one. It should not add the number itself.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape: counting only the items that match a condition.',
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
        note: 'Adding the number rather than 1, which is summing when they meant to count.',
      },
    ],
  },

  // ------------------------------------------ dictionaries and functions (19-20)
  {
    id: 'lookup-price',
    title: 'Look up a price',
    section: 'dicts',
    concept: 'looking a value up by its key in a dictionary',
    prompt:
      '`prices` pairs each fruit with its price in pence. Print the price of a pear. It should print 65.',
    starter:
      'prices = {"apple": 40, "pear": 65, "plum": 30}\n\n# Print the price of a pear here.\n',
    expectedStdout: '65',
    hints: [
      {
        tier: 1,
        text: 'This is not a list, and you do not reach into it by position. You reach into it by name.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 3. Square brackets again, but what goes inside them this time is text rather than a position.',
        targetLine: 3,
      },
      {
        tier: 3,
        text: 'A dictionary pairs each key with a value, and handing it a key gives back that key’s value. The key here is a piece of text, so it needs quotes. Without them Python goes looking for a variable of that name.',
        targetLine: 3,
      },
      {
        tier: 4,
        text: 'Same shape, looking a value up by its key.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncapitals = {"France": "Paris", "Japan": "Tokyo"}\n\nprint(capitals["Japan"])\n',
      },
      {
        tier: 5,
        text: 'On line 3 type `print(prices["pear"])`. The quotes around the key are what make it a key rather than a variable. Type it yourself.',
        targetLine: 3,
        scratch:
          '# Same shape, different problem\ncapitals = {"France": "Paris", "Japan": "Tokyo"}\n\nprint(capitals["Japan"])\n',
      },
    ],
    watch: [],
  },

  {
    id: 'make-a-function',
    title: 'Make a function',
    section: 'functions',
    concept: 'defining a function that takes a value in and hands one back',
    prompt:
      'Write a function called `double` that takes one number and gives back twice that number. The last line already calls it and should print 42.',
    starter:
      '# Write your function here.\n# It takes one number and gives back twice that number.\n\n\nprint(double(21))\n',
    expectedStdout: '42',
    hints: [
      {
        tier: 1,
        text: 'A function is a named piece of code you can run whenever you like. Python has one keyword for defining one, and another for handing a value back out of it.',
        targetLine: null,
      },
      {
        tier: 2,
        text: 'Line 4 defines it, and the indented line under that is what it hands back. The call at the bottom stays exactly where it is.',
        targetLine: 4,
      },
      {
        tier: 3,
        text: 'The name in the brackets of the definition is a placeholder: it stands for whatever number is passed in at the moment the function is called. Handing a value back is not the same as printing it. Printing shows the value and hands back nothing at all.',
        targetLine: 4,
      },
      {
        tier: 4,
        text: 'Same shape: one value in, another handed back out.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\ndef add_ten(x):\n    return x + 10\n\nprint(add_ten(5))\n',
      },
      {
        tier: 5,
        text: 'On line 4 type `def double(n):`, press Enter, and type `return n * 2` indented underneath it. Type it yourself.',
        targetLine: 4,
        scratch:
          '# Same shape, different problem\ndef add_ten(x):\n    return x + 10\n\nprint(add_ten(5))\n',
      },
    ],
    watch: [],
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

/** Index by id — tests and saved progress address exercises by name, not
 *  position, so inserting an exercise never silently repoints them. */
export function indexOfExercise(id: string): number {
  return EXERCISES.findIndex((e) => e.id === id)
}
