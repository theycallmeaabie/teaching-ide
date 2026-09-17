import { EXERCISES } from '../lesson/exercises'
import { goToExercise } from '../lesson/teaching'
import { useStore } from '../store'

export function LessonBar() {
  const index = useStore((s) => s.exerciseIndex)
  const solved = useStore((s) => s.solved)
  const exercise = EXERCISES[index]

  return (
    <div className="lessonbar">
      <div className="lesson-main">
        <div className="lesson-title">
          <span className="lesson-count">
            {index + 1} / {EXERCISES.length}
          </span>
          {exercise.title}
          {solved[index] && <span className="solved-tick">solved</span>}
        </div>
        <p className="lesson-prompt">{exercise.prompt}</p>
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
        <button className="btn btn-ghost small" disabled={index === 0} onClick={() => goToExercise(index - 1)}>
          Back
        </button>
        <button
          className={`btn small ${solved[index] ? 'btn-primary' : 'btn-ghost'}`}
          disabled={index === EXERCISES.length - 1}
          onClick={() => goToExercise(index + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
