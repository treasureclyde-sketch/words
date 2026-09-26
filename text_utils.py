"""
text_utils.py — сравнение твоего ответа с правильным.

Нам нужно "по-человечески" проверять ответы:
- без учёта регистра (Streamline == streamline),
- без лишних пробелов ("  hello   world " == "hello world"),
- с допуском на мелкие опечатки (streamlien ~= streamline).

Для опечаток считаем "расстояние Левенштейна" — это минимальное число
правок (вставить/удалить/заменить одну букву), чтобы превратить одно слово
в другое. Если правок мало — считаем, что человек просто опечатался.
"""

import re


def normalize(text: str) -> str:
    """
    Приводим строку к "чистому" виду:
    - убираем пробелы по краям,
    - схлопываем несколько пробелов в один,
    - переводим в нижний регистр.
    """
    if text is None:
        return ""
    text = text.strip().lower()
    text = re.sub(r"\s+", " ", text)  # несколько пробелов/табов → один пробел
    return text


def levenshtein(a: str, b: str) -> int:
    """
    Классический алгоритм расстояния Левенштейна через динамическое
    программирование. Возвращает число правок между строками a и b.
    Не пугайся кода — это стандартный приём, его можно просто использовать.
    """
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    # prev[j] — расстояние до подстроки b длиной j
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                prev[j] + 1,       # удаление
                curr[j - 1] + 1,   # вставка
                prev[j - 1] + cost # замена (или совпадение)
            )
        prev = curr
    return prev[-1]


def _allowed_typos(length: int) -> int:
    """
    Сколько опечаток прощаем в зависимости от длины слова:
    - короткие слова (<=4) — 0 (иначе "cat" == "cut", это уже другое слово),
    - средние (5..7) — 1 опечатка,
    - длинные (>=8) — 2 опечатки.
    """
    if length <= 4:
        return 0
    if length <= 7:
        return 1
    return 2


def is_correct(user_answer: str, correct_answer: str) -> bool:
    """
    Главная функция проверки. correct_answer может содержать несколько
    вариантов через запятую/точку с запятой/слэш (например перевод
    "оптимизировать, упрощать"). Считаем ответ верным, если он совпадает
    (с допуском на опечатки) хотя бы с ОДНИМ вариантом.
    """
    user = normalize(user_answer)
    if not user:
        return False

    # Разбиваем правильный ответ на варианты по разделителям , ; / |
    variants = re.split(r"[,;/|]", correct_answer or "")
    for variant in variants:
        target = normalize(variant)
        if not target:
            continue
        if user == target:
            return True
        # Допуск на опечатки: считаем по длине более длинного слова.
        allowed = _allowed_typos(max(len(user), len(target)))
        if allowed > 0 and levenshtein(user, target) <= allowed:
            return True
    return False
