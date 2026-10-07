import type { ReactNode } from 'react'
import { EXERCISES } from '../lesson/exercises'
import { goToExercise } from '../lesson/teaching'
import { useStore } from '../store'
import { ArrowLeftIcon, ArrowRightIcon, FlagIcon } from './icons'

/** Exercise prompts mark code with backticks; show it as code. */
function inline(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))
}

export function LessonBar() {
  const index = useStore((s) => s.exerciseIndex)
  const solved = useStore((s) => s.solved)
  const exercise = EXERCISES[index]

  return (
    <div className="lessonbar">
      <div className="lesson-main">
        <div className="lesson-title">
          <span className="lesson-count">
            <b>{index + 1}</b>
            <i>/</i>
            <span>{EXERCISES.length}</span>
          </span>
          {exercise.title}
          {solved[index] && <span className="solved-tick">solved</span>}
        </div>
        <p className="lesson-prompt">
          <FlagIcon size={14} />
          <span>{inline(exercise.prompt)}</span>
        </p>
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
            <ArrowLeftIcon size={14} />
            Back
          </button>
          <button
            className={`btn small ${solved[index] ? 'btn-primary' : ''}`}
            disabled={index === EXERCISES.length - 1}
            onClick={() => goToExercise(index + 1)}
          >
            Next
            <ArrowRightIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
