/** Pure quiz-scoring and deterministic ranking logic. No database dependency. */
export function normaliseQuizAnswer(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function calculateQuizScore(questions = [], answers = []) {
  const answerMap = new Map((answers || []).map(answer => [
    String(answer.questionId ?? answer.id ?? ''),
    (Array.isArray(answer.response) ? answer.response : []).map(normaliseQuizAnswer).filter(Boolean)
  ]));
  let score = 0;
  let totalPoints = 0;
  for (const question of questions) {
    const points = Number(question.points) || 1;
    totalPoints += points;
    const response = answerMap.get(String(question._id ?? question.id ?? '')) || [];
    const correct = (question.correctAnswers || []).map(normaliseQuizAnswer).filter(Boolean);
    let isCorrect = false;
    if (question.type === 'multiple_choice') {
      const responseSorted = [...new Set(response)].sort();
      const correctSorted = [...new Set(correct)].sort();
      isCorrect = responseSorted.length === correctSorted.length && responseSorted.every((value, index) => value === correctSorted[index]);
    } else {
      isCorrect = response.length === 1 && correct.includes(response[0]);
    }
    if (isCorrect) score += points;
  }
  return { score, totalPoints };
}

/** Rank is intentionally a row number, not competition ranking: every participant has a unique integer rank. */
export function rankQuizResults(attempts = []) {
  const ordered = [...attempts].sort((a, b) =>
    (Number(b.score || 0) - Number(a.score || 0)) ||
    (Number(a.elapsedSeconds || 0) - Number(b.elapsedSeconds || 0)) ||
    (new Date(a.submittedAt || 0).getTime() - new Date(b.submittedAt || 0).getTime()) ||
    String(a.userId?.username || a.username || '').localeCompare(String(b.userId?.username || b.username || '')) ||
    String(a.userId?._id || a.userId?.id || a.userId || a.id || '').localeCompare(String(b.userId?._id || b.userId?.id || b.userId || b.id || ''))
  );
  return ordered.map((attempt, index) => ({ attempt, rank: index + 1 }));
}
