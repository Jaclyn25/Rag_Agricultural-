export const STOP_WORDS_AR = [
  "في", "من", "إلى", "عن", "على", "مع", "كان", "هذا", "هذه", "ذلك",
  "تلك", "هو", "هي", "هم", "هن", "و", "ف", "ب", "ل", "ك", "لا", "ما",
  "لم", "لن", "إن", "أن", "قد", "كل", "بعض", "أو", "ثم", "حتى", "إذا",
  "عند", "بين", "تحت", "فوق", "خلال", "دون", "وال", "ال", "التي", "الذي",
  "الذين", "اللذان", "اللواتي", "به", "لها", "لهم", "له", "منها", "منهم",
  "عليها", "عليهم", "فيها", "فيهم", "وقد", "ولم", "ولا", "ومن", "عليه"
];

const NORMALIZATION_ALEF = /[أإآ]/g;
const NORMALIZATION_YA = /ى/g;
const TATWEEL = /\u0640/g;
const DIACRITICS = /[\u064B-\u065F\u0670]/g;
const NON_ARABIC_WORD = /[^\u0600-\u06FF\w\s]/g;
const WHITESPACE = /\s+/g;

export function normalizeArabic(text) {
  return String(text)
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(NORMALIZATION_ALEF, "ا")
    .replace(NORMALIZATION_YA, "ي")
    .replace(NON_ARABIC_WORD, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

const STOP_WORDS_SET = new Set(STOP_WORDS_AR.map(w => normalizeArabic(w)));

export function tokenize(text) {
  return normalizeArabic(text)
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS_SET.has(t));
}
