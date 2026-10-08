import type { ReactNode } from 'react'
import { EXERCISES } from '../lesson/exercises'
import { goToExercise } from '../lesson/teaching'
import { useStore } from '../store'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FlagIcon } from './icons'

/** Exercise prompts mark code with backticks; show it as code. */
function inline(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))
}

export function LessonBar() {
  const index = useStore((s) => s.exerciseIndex)
  const solved = useStore((s) => s.solved)
  const exercise = EXERCISES[index]
  const done = !!solved[index]

  return (
    <div className={`lessonbar ${done ? 'solved' : ''}`}>
      <div className="lesson-top">
        <div className="lesson-title">
          <span className="lesson-count">
            <b>{index + 1}</b>
            <i>/</i>
            <span>{EXERCISES.length}</span>
          </span>
          {exercise.title}
          {done && <span className="solved-tick">solved</span>}
        </div>

        <div className="lesson-nav">
          <div className="dots">
            {EXERCISES.map((e, i) => (
              <button
                key={e.id}
                className={`dot ${i === index ? 'now' : ''} ${solved[i] ? 'done' : ''}`}
                title={e.title}
                onClick={() => goToExercise(i)}
              />
            ))}
          </div>
          <div className="lesson-steps">
            <button className="btn btn-ghost small" disabled={index === 0} onClick={() => goToExercise(index - 1)}>
              <ArrowLeftIcon size={16} />
              Back
            </button>
            <button
              className={`btn small ${done ? 'btn-primary' : ''}`}
              disabled={index === EXERCISES.length - 1}
              onClick={() => goToExercise(index + 1)}
            >
              Next
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* The task is what a learner most needs to see, so it is the largest and
          brightest thing in the strip, and it turns green when it is done. */}
      <p className="lesson-prompt">
        <span className="lesson-label">
          {done ? <CheckIcon size={14} /> : <FlagIcon size={14} />}
          {done ? 'Done' : 'Your task'}
        </span>
        <span className="lesson-q">{inline(exercise.prompt)}</span>
      </p>
    </div>
  )
}
