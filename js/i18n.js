export const translations = {
  en: {
    dir: "ltr",
    title: "Ramadan Bag — Your Voice, Your Bag",
    subtitle:
      "Tell us what you actually need in your Ramadan bag. Your vote helps us build it around real needs.",
    langToggle: "العربية",
    resultsHeading: "Current Preferences",
    itemsHeading: "Vote on Bag Contents",
    addItem: "+ Add Item",
    suggestItem: "+ Suggest an Item",
    suggestedHeading: "Suggested Items",
    suggestedEmpty: "No suggestions yet. Be the first!",
    votes: "votes",
    vote: "vote",
    yourVote: "Your answer",
    loading: "Loading…",
    noItems: "No items yet. Add the first one!",
    quantityPlaceholder: "Enter a number",
    submitVote: "Submit",
    updateVote: "Update",
    yourAnswerIs: "Your answer:",
    distributionHeading: "What others answered",
    noAnswersYet: "No answers yet — be the first!",
    modalAddItemTitle: "Add a New Item",
    itemNameLabel: "Item name",
    itemNamePlaceholder: "e.g. Lentils",
    questionLabel: "Question",
    questionPlaceholder: "e.g. How much lentils would you prefer?",
    unitLabel: "Unit",
    unitPlaceholder: "e.g. KG, bottles, packs",
    submit: "Add Item",
    cancel: "Cancel",
    modalSuggestTitle: "Suggest an Item",
    suggestNameLabel: "Item name",
    suggestNamePlaceholder: "e.g. Tea",
    submitSuggestion: "Submit Suggestion",
    suggestions: "suggestions",
    suggestion: "suggestion",
    alreadySuggested: "You already suggested this item",
    errorRequired: "Please fill in all required fields.",
    errorInvalidQuantity: "Please enter a valid positive number.",
    errorTooLong: "That text is too long.",
    errorGeneric: "Something went wrong. Please try again.",
    footerNote: "All votes are anonymous. One answer per item per device/account.",
    adminLink: "Admin",
  },
  ar: {
    dir: "rtl",
    title: "كيس رمضان — صوتك، كيسك",
    subtitle: "أخبرنا بما تحتاجه فعلاً في كيس رمضان. صوتك يساعدنا على بنائه حسب الاحتياجات الحقيقية.",
    langToggle: "English",
    resultsHeading: "التفضيلات الحالية",
    itemsHeading: "صوّت على محتويات الكيس",
    addItem: "+ إضافة عنصر",
    suggestItem: "+ اقتراح عنصر",
    suggestedHeading: "العناصر المقترحة",
    suggestedEmpty: "لا توجد اقتراحات بعد. كن أول من يقترح!",
    votes: "صوت",
    vote: "صوت",
    yourVote: "إجابتك",
    loading: "جارٍ التحميل…",
    noItems: "لا توجد عناصر بعد. أضف أول عنصر!",
    quantityPlaceholder: "أدخل رقماً",
    submitVote: "إرسال",
    updateVote: "تحديث",
    yourAnswerIs: "إجابتك:",
    distributionHeading: "ماذا أجاب الآخرون",
    noAnswersYet: "لا توجد إجابات بعد — كن أول من يجيب!",
    modalAddItemTitle: "إضافة عنصر جديد",
    itemNameLabel: "اسم العنصر",
    itemNamePlaceholder: "مثال: عدس",
    questionLabel: "السؤال",
    questionPlaceholder: "مثال: كم كمية العدس المفضلة لديك؟",
    unitLabel: "الوحدة",
    unitPlaceholder: "مثال: كجم، زجاجة، عبوة",
    submit: "إضافة العنصر",
    cancel: "إلغاء",
    modalSuggestTitle: "اقتراح عنصر",
    suggestNameLabel: "اسم العنصر",
    suggestNamePlaceholder: "مثال: شاي",
    submitSuggestion: "إرسال الاقتراح",
    suggestions: "اقتراحات",
    suggestion: "اقتراح",
    alreadySuggested: "لقد اقترحت هذا العنصر بالفعل",
    errorRequired: "يرجى ملء جميع الحقول المطلوبة.",
    errorInvalidQuantity: "يرجى إدخال رقم موجب صحيح.",
    errorTooLong: "هذا النص طويل جداً.",
    errorGeneric: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
    footerNote: "جميع الإجابات مجهولة. إجابة واحدة لكل عنصر لكل جهاز/حساب.",
    adminLink: "الإدارة",
  },
};

const STORAGE_KEY = "ramadan_bag_lang";

export function getLang() {
  return localStorage.getItem(STORAGE_KEY) || "en";
}

export function setLang(lang) {
  localStorage.setItem(STORAGE_KEY, lang);
}

export function t(key, lang = getLang()) {
  return translations[lang]?.[key] ?? translations.en[key] ?? key;
}

export function applyDocumentDirection(lang = getLang()) {
  const dir = translations[lang]?.dir || "ltr";
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("dir", dir);
}
