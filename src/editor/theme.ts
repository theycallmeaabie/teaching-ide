import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Every colour is a CSS variable from styles.css, so switching theme is a
 * repaint. The editor is never rebuilt — that would destroy the learner's buffer.
 */
const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: [t.bool, t.null, t.meta], color: 'var(--syn-atom)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.definition(t.variableName), t.className], color: 'var(--syn-def)' },
  { tag: t.invalid, color: 'var(--danger)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '16px', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selection)' },
  // The design drops the gutter's rule and lets tone do the separating; the
  // line number the learner is on is the one that lights up.
  '.cm-gutters': {
    backgroundColor: 'var(--gutter-bg)',
    color: 'var(--gutter-ink)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--active-line)',
    color: 'var(--accent)',
    fontWeight: '600',
  },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--selection)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--gutter-bg)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
  },
  // basicSetup brings autocomplete and search; their popups default to light
  // surfaces with inherited text, which would be unreadable in the dark theme.
  '.cm-tooltip': {
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  },
  '.cm-panels': { backgroundColor: 'var(--gutter-bg)', color: 'var(--text)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
})

export const editorTheme = [theme, syntaxHighlighting(highlight)]
