import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuizScore, rankQuizResults } from '../src/quiz-domain.js';

test('quiz scoring handles single choice, multiple choice, true/false, and case-insensitive short answers', () => {
  const questions = [
    { _id: 'q1', type: 'single_choice', correctAnswers: ['Jupiter'], points: 2 },
    { _id: 'q2', type: 'multiple_choice', correctAnswers: ['A', 'C'], points: 3 },
    { _id: 'q3', type: 'true_false', correctAnswers: ['True'], points: 1 },
    { _id: 'q4', type: 'short_answer', correctAnswers: ['Hyper Text Markup Language', 'HTML'], points: 4 }
  ];
  const answers = [
    { questionId: 'q1', response: ['jUpItEr'] },
    { questionId: 'q2', response: ['C', 'A'] },
    { questionId: 'q3', response: ['true'] },
    { questionId: 'q4', response: [' html '] }
  ];
  assert.deepEqual(calculateQuizScore(questions, answers), { score: 10, totalPoints: 10 });
});

test('multiple choice is all-or-nothing and an extra answer does not score', () => {
  const questions = [{ _id: 'q1', type: 'multiple_choice', correctAnswers: ['A', 'B'], points: 5 }];
  assert.deepEqual(calculateQuizScore(questions, [{ questionId: 'q1', response: ['A'] }]), { score: 0, totalPoints: 5 });
  assert.deepEqual(calculateQuizScore(questions, [{ questionId: 'q1', response: ['A', 'B', 'C'] }]), { score: 0, totalPoints: 5 });
});

test('quiz ranks are deterministic and unique even when participants tie on score and time', () => {
  const sameTime = new Date('2026-10-16T10:00:00.000Z');
  const attempts = [
    { id: 'c', score: 8, elapsedSeconds: 30, submittedAt: sameTime, userId: { username: 'zed', _id: '3' } },
    { id: 'b', score: 8, elapsedSeconds: 30, submittedAt: sameTime, userId: { username: 'amy', _id: '2' } },
    { id: 'a', score: 9, elapsedSeconds: 80, submittedAt: sameTime, userId: { username: 'bob', _id: '1' } },
    { id: 'd', score: 8, elapsedSeconds: 20, submittedAt: sameTime, userId: { username: 'kim', _id: '4' } }
  ];
  const ranked = rankQuizResults(attempts);
  assert.deepEqual(ranked.map(row => row.rank), [1, 2, 3, 4]);
  assert.deepEqual(ranked.map(row => row.attempt.id), ['a', 'd', 'b', 'c']);
  assert.equal(new Set(ranked.map(row => row.rank)).size, attempts.length);
});
