import assert from 'node:assert/strict'
import { gradeCopy, gradeKochSession, buildVisualQuestion, deckEntries } from '../src/utils/morseTrainer.js'
import { DAY, emptyLearning, readLearning, recordAttempt, morseMastery, reviewCandidates, buildReviewDrill, courseReady } from '../src/utils/morseProgress.js'

let checks = 0
const test = (label, fn) => { fn(); checks++; console.log(`  ok   ${label}`) }
const now = Date.UTC(2026, 8, 18, 12)
const correct = [{ char: 'K', got: 'K', ok: true }]

test('An omitted first letter leaves nine matches and only one failed character', () => {
  const g = gradeKochSession('KMURESNAPT', 'MURESNAPT')
  assert.equal(g.accuracy, 90)
  assert.equal(g.characterResults.filter(r => !r.ok).length, 1)
  assert.equal(g.characterResults.find(r => !r.ok).char, 'K')
})
test('Trailing insertions lower the score and are not attributed to a target letter', () => {
  const g = gradeCopy('KMURE', 'KMUREXXX')
  assert.equal(g.accuracy, 40)
  assert.equal(g.errors, 3)
  assert.equal(g.characterResults.filter(r => r.char === null).length, 3)
})
test('A middle insertion preserves the surrounding matches', () => {
  const g = gradeCopy('KMURE', 'KMXURE')
  assert.equal(g.accuracy, 80)
  assert.equal(g.correct, 5)
  assert.equal(g.cells[2].operation, 'insertion')
})
test('Aligned edits reconstruct both inputs and match a reference distance', () => {
  const distance = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? j ? 0 : i : j))
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + +(a[i - 1] !== b[j - 1]))
    return d[a.length][b.length]
  }
  const words = ['', 'K', 'M', 'KK', 'KM', 'MK', 'MM', 'KMK', 'MKM', 'KKM']
  for (const a of words) for (const b of words) {
    const g = gradeCopy(a, b)
    assert.equal(g.cells.map(c => c.expected || '').join(''), a)
    assert.equal(g.cells.map(c => c.got || '').join(''), b)
    assert.equal(g.errors, distance(a, b))
    assert.equal(g.errors, g.cells.filter(c => !c.ok).length)
  }
})
test('The two-letter visual quiz can repeat, so it does not reveal the next answer', () => {
  assert.equal(buildVisualQuestion({ pool: deckEntries('koch', 1), excludeChar: 'K', rng: () => 0 }).entry.char, 'K')
})
test('Visual and transmission successes never change reception', () => {
  const original = emptyLearning()
  const visual = recordAttempt(original, 'visual', correct, { now })
  const state = recordAttempt(visual, 'transmission', correct, { now })
  assert.deepEqual(state.skills.reception, original.skills.reception)
  assert.equal(original.skills.visual.stats.correct, 0)
})
test('Insertion errors count in statistics without creating a fictitious character record', () => {
  const s = recordAttempt(emptyLearning(), 'reception', gradeCopy('KM', 'KMX').characterResults, { now })
  assert.equal(s.skills.reception.stats.wrong, 1)
  assert.equal(s.skills.reception.progress.X, undefined)
})
test('Many successes in one session or day cannot consolidate a letter', () => {
  let s = recordAttempt(emptyLearning(), 'reception', Array(20).fill(correct[0]), { now })
  s = recordAttempt(s, 'reception', correct, { now: now + 1000 })
  assert.equal(s.skills.reception.progress.K.reviewDays, 1)
  assert.equal(morseMastery('K', s.skills.reception.progress, now), 'progreso')
})
test('Only due reviews on different days consolidate; early repeats do not postpone reviews', () => {
  let s = recordAttempt(emptyLearning(), 'reception', correct, { now })
  s = recordAttempt(s, 'reception', correct, { now: now + DAY })
  const due = s.skills.reception.progress.K.dueAt
  s = recordAttempt(s, 'reception', correct, { now: now + 2 * DAY })
  assert.equal(s.skills.reception.progress.K.reviewDays, 2)
  assert.equal(s.skills.reception.progress.K.dueAt, due)
  s = recordAttempt(s, 'reception', correct, { now: due })
  assert.equal(morseMastery('K', s.skills.reception.progress, due), 'dominado')
  assert.equal(morseMastery('K', s.skills.reception.progress, due + 7 * DAY), 'flojo')
})
test('Replay or hints record assisted successes without promoting retention', () => {
  const a = recordAttempt(emptyLearning(), 'reception', correct, { now, assisted: true })
  const b = recordAttempt(a, 'reception', [{ ...correct[0], hinted: true }], { now })
  assert.equal(b.skills.reception.progress.K.reviewDays, 0)
  assert.equal(b.skills.reception.stats.hinted, 2)
  assert.equal(b.skills.reception.stats.streak, 0)
})
test('One failure in a group prevents later matches in the same group from hiding the error', () => {
  const s = recordAttempt(emptyLearning(), 'reception', [{ char: 'K', got: 'M', ok: false }, ...correct], { now })
  assert.equal(s.skills.reception.progress.K.needsReview, true)
  assert.equal(s.skills.reception.progress.K.confusions.M, 1)
  assert.equal(s.skills.reception.progress.K.reviewDays, 0)
})
test('Review uses actual errors and confusions but never leaks outside the active lesson', () => {
  const s = recordAttempt(emptyLearning(), 'reception', [{ char: 'K', got: 'X', ok: false }, { char: 'K', got: 'M', ok: false }], { now })
  const progress = s.skills.reception.progress
  const pool = deckEntries('koch', 1)
  for (const n of [0, 0.1, 0.45, 0.65, 0.99]) {
    const d = buildReviewDrill({ pool, progress, now, rng: () => n })
    assert.equal(d.focus, 'K')
    assert.equal(d.confusion, 'M')
    assert(d.text.includes('K'))
    assert.match(d.text, /^[KM]{5}$/)
  }
})
test('No errors or overdue items gives an empty review, not an unrelated random quiz', () => {
  assert.equal(buildReviewDrill({ pool: deckEntries('koch', 1), now }), null)
  const s = recordAttempt(emptyLearning(), 'reception', correct, { now })
  assert.equal(reviewCandidates(deckEntries('koch', 1), s.skills.reception.progress, now).length, 0)
  assert.equal(reviewCandidates(deckEntries('koch', 1), s.skills.reception.progress, now + DAY).length, 1)
})
test('A failed scheduled review resets consolidation', () => {
  let s = emptyLearning()
  for (const offset of [0, 1, 4]) s = recordAttempt(s, 'reception', correct, { now: now + offset * DAY })
  s = recordAttempt(s, 'reception', [{ char: 'K', got: 'M', ok: false }], { now: now + 5 * DAY })
  assert.equal(s.skills.reception.progress.K.reviewDays, 0)
  assert.equal(morseMastery('K', s.skills.reception.progress, now + 5 * DAY), 'flojo')
})
test('Malformed storage and old mixed progress cannot masquerade as reception skill', () => {
  for (const value of [null, [], { K: { box: 4 } }, { version: 2, skills: {} }]) assert.deepEqual(readLearning(value), emptyLearning())
  const state = recordAttempt(emptyLearning(), 'reception', correct, { now })
  assert.deepEqual(readLearning(JSON.parse(JSON.stringify(state))), JSON.parse(JSON.stringify(state)))
})
const settings = { lesson: 2, charWpm: 20, effWpm: 10, minutes: 1, groupMode: 'fixed', extraGroupGap: 0 }
const attempts = [1, 2, 3].map(id => ({ ...settings, version: 2, sessionId: String(id), completed: true, assisted: false, accuracy: 95, newCharAccuracy: 100, newCharTotal: 5 }))
test('Promotion requires three distinct completed practices with matching settings', () => {
  assert(courseReady(attempts, settings))
  assert(!courseReady(attempts.slice(0, 2), settings))
  assert(!courseReady([attempts[0], attempts[0], attempts[0]], settings))
  for (const change of [{ lesson: 3 }, { charWpm: 25 }, { effWpm: 8 }, { minutes: 2 }, { groupMode: 'random' }, { extraGroupGap: 1 }]) assert(!courseReady(attempts, { ...settings, ...change }))
})
test('Assisted, interrupted, old, weak or undersampled attempts cannot recommend promotion', () => {
  for (const change of [{ assisted: true }, { completed: false }, { version: 1 }, { accuracy: 89 }, { newCharAccuracy: 80 }, { newCharTotal: 2 }]) {
    assert(!courseReady([attempts[0], attempts[1], { ...attempts[2], ...change }], settings))
  }
})
console.log(`Morse learning regressions passed: ${checks} checks.`)
