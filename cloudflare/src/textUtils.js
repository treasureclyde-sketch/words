// textUtils.js — сравнение ответа пользователя с правильным.
// Аналог text_utils.py: без учёта регистра/пробелов и с допуском на опечатки.

// Приводим строку к "чистому" виду: убираем лишние пробелы и регистр.
export function normalize(text) {
  if (!text) return "";
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Расстояние Левенштейна — сколько правок (вставить/удалить/заменить букву)
// нужно, чтобы превратить строку a в b. Стандартный алгоритм.
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // удаление
        curr[j - 1] + 1,    // вставка
        prev[j - 1] + cost  // замена (или совпадение)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// Сколько опечаток прощаем в зависимости от длины слова.
function allowedTypos(length) {
  if (length <= 4) return 0;   // короткие — без прощения (cat != cut)
  if (length <= 7) return 1;
  return 2;
}

// Главная проверка. correctAnswer может содержать варианты через , ; / | —
// принимаем ответ, если он совпал (с допуском) хотя бы с одним.
export function isCorrect(userAnswer, correctAnswer) {
  const user = normalize(userAnswer);
  if (!user) return false;

  const variants = (correctAnswer || "").split(/[,;/|]/);
  for (const variant of variants) {
    const target = normalize(variant);
    if (!target) continue;
    if (user === target) return true;
    const allowed = allowedTypos(Math.max(user.length, target.length));
    if (allowed > 0 && levenshtein(user, target) <= allowed) return true;
  }
  return false;
}
