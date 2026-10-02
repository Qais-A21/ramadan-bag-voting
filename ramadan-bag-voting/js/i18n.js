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
    yourVote: "Your vote",
    tapToVote: "Tap to vote",
    changeVote: "Change vote",
    loading: "Loading…",
    noItems: "No items yet. Add the first one!",
    modalAddItemTitle: "Add a New Item",
    itemNameLabel: "Item name",
    itemNamePlaceholder: "e.g. Lentils",
    questionLabel: "Question",
    questionPlaceholder: "e.g. How much lentils would you prefer?",
    optionsLabel: "Options",
    optionPlaceholder: "e.g. 2 KG",
    addOption: "+ Add option",
    removeOption: "Remove",
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
    errorMinOptions: "Please provide at least 2 options.",
    errorDuplicateOptions: "Options must be unique.",
    errorTooLong: "That text is too long.",
    errorGeneric: "Something went wrong. Please try again.",
    footerNote: "All votes are anonymous. One vote per item per device/account.",
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
    yourVote: "تصويتك",
    tapToVote: "اضغط للتصويت",
    changeVote: "تغيير التصويت",
    loading: "جارٍ التحميل…",
    noItems: "لا توجد عناصر بعد. أضف أول عنصر!",
    modalAddItemTitle: "إضافة عنصر جديد",
    itemNameLabel: "اسم العنصر",
    itemNamePlaceholder: "مثال: عدس",
    questionLabel: "السؤال",
    questionPlaceholder: "مثال: كم كمية العدس المفضلة لديك؟",
    optionsLabel: "الخيارات",
    optionPlaceholder: "مثال: 2 كجم",
    addOption: "+ إضافة خيار",
    removeOption: "إزالة",
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
    errorMinOptions: "يرجى تقديم خيارين على الأقل.",
    errorDuplicateOptions: "يجب أن تكون الخيارات فريدة.",
    errorTooLong: "هذا النص طويل جداً.",
    errorGeneric: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
    footerNote: "جميع الأصوات مجهولة. صوت واحد لكل عنصر لكل جهاز/حساب.",
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
