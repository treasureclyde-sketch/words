"""
dictionary.py — получаем данные о слове из интернета.

Что делаем:
1) Перевод на русский — через Google Translate (библиотека deep-translator),
   либо через DeepL, если в .env задан ключ DEEPL_API_KEY.
2) Транскрипцию, определение на английском и пример — через бесплатный
   Free Dictionary API (https://dictionaryapi.dev).
3) Множественное число английского существительного — через библиотеку inflect
   (работает офлайн, без интернета).

Все сетевые вызовы обёрнуты в try/except: если интернет/сервис недоступен,
бот не должен падать — он просто вернёт то, что смог получить.
"""

import requests
from deep_translator import GoogleTranslator, MyMemoryTranslator
import inflect

import config

# "Движок" inflect для работы с английской грамматикой (мн. число и т.п.).
_inflect_engine = inflect.engine()

# Адрес бесплатного словаря. {word} подставим при запросе.
FREE_DICT_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/{word}"

# Таймаут на сетевые запросы (в секундах), чтобы бот не "завис" надолго.
HTTP_TIMEOUT = 10


def translate_to_russian(word: str) -> str:
    """
    Переводим слово на русский.
    Сначала пробуем DeepL (если задан ключ), иначе — Google Translate.
    Если совсем ничего не вышло — возвращаем пустую строку.
    """
    # Вариант 1: DeepL (только если пользователь дал ключ в .env)
    if config.DEEPL_API_KEY:
        try:
            resp = requests.post(
                "https://api-free.deepl.com/v2/translate",
                data={
                    "auth_key": config.DEEPL_API_KEY,
                    "text": word,
                    "source_lang": "EN",
                    "target_lang": "RU",
                },
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            return resp.json()["translations"][0]["text"]
        except Exception:
            # Если DeepL не сработал — не сдаёмся, идём в Google ниже.
            pass

    # Вариант 2: Google Translate через deep-translator (бесплатно, без ключа)
    try:
        result = GoogleTranslator(source="en", target="ru").translate(word)
        if result:
            return result
    except Exception:
        pass  # например, Google временно ограничил частоту запросов

    # Вариант 3 (запасной): MyMemory — другой бесплатный сервис без ключа.
    # Пригодится, если Google вдруг недоступен или лимитирует запросы.
    try:
        result = MyMemoryTranslator(source="en-US", target="ru-RU").translate(word)
        return result or ""
    except Exception:
        return ""


def fetch_from_free_dictionary(word: str) -> dict:
    """
    Запрашиваем транскрипцию, определение и пример из Free Dictionary API.
    Возвращаем словарь с ключами phonetic / definition / example.
    Если слова нет в словаре или сервис недоступен — вернём пустые значения.
    """
    result = {"phonetic": "", "definition": "", "example": "", "found": False}
    try:
        resp = requests.get(
            FREE_DICT_URL.format(word=word), timeout=HTTP_TIMEOUT
        )
        # 404 = слова нет в словаре (это нормально, не ошибка программы).
        if resp.status_code == 404:
            return result
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return result

    # Ответ — это список "статей" о слове. Берём первую.
    if not isinstance(data, list) or not data:
        return result
    entry = data[0]
    result["found"] = True

    # Транскрипция: сначала поле phonetic, иначе ищем в списке phonetics.
    result["phonetic"] = entry.get("phonetic", "") or ""
    if not result["phonetic"]:
        for ph in entry.get("phonetics", []):
            if ph.get("text"):
                result["phonetic"] = ph["text"]
                break

    # Определение и пример: идём по значениям (meanings → definitions)
    # и берём первое определение; заодно первый попавшийся пример.
    for meaning in entry.get("meanings", []):
        for d in meaning.get("definitions", []):
            if not result["definition"] and d.get("definition"):
                result["definition"] = d["definition"]
            if not result["example"] and d.get("example"):
                result["example"] = d["example"]
            if result["definition"] and result["example"]:
                break
        if result["definition"] and result["example"]:
            break

    return result


def lookup(word: str) -> dict:
    """
    Главная функция: собираем всё о слове в один словарь.
    Возвращаем: word, phonetic, translation, definition, example, found.
    'found' = было ли слово в англ. словаре (если нет — есть только перевод).
    """
    word = word.strip()
    info = fetch_from_free_dictionary(word)
    translation = translate_to_russian(word)
    return {
        "word": word,
        "phonetic": info["phonetic"],
        "translation": translation,
        "definition": info["definition"],
        "example": info["example"],
        "found": info["found"],
    }


def plural(word: str) -> str:
    """
    Множественное число английского слова (car → cars, city → cities).
    inflect.plural_noun вернёт False, если не смог — тогда отдаём как есть.
    """
    word = word.strip()
    result = _inflect_engine.plural_noun(word)
    return result or word
