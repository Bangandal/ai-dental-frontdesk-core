import type { RuntimeReplyLanguage } from './runtimeReplyLanguage.js';

export type RuntimeReplyTemplateKey =
  | 'missing_service_for_availability'
  | 'availability_query_unknown'
  | 'specific_date_missing_date'
  | 'exact_slot_missing_date'
  | 'exact_slot_missing_time'
  | 'exact_slot_invalid_time'
  | 'time_window_missing_or_invalid'
  | 'time_window_invalid_range'
  | 'availability_date_in_past'
  | 'exact_slot_date_in_past'
  | 'booking_interest_missing_datetime'
  | 'off_topic'
  | 'booking_error'
  | 'faq_address_missing'
  | 'faq_price_missing'
  | 'faq_insurance_missing'
  | 'post_booking_question'
  | 'safe_fallback';

const templates: Record<RuntimeReplyLanguage, Record<RuntimeReplyTemplateKey, string>> = {
  ru: {
    missing_service_for_availability: 'Подскажите, пожалуйста, на какую услугу или консультацию хотите записаться?',
    availability_query_unknown: 'Подскажите, пожалуйста, удобный день или время — проверю свободные варианты.',
    specific_date_missing_date: 'Подскажите, пожалуйста, конкретную дату — проверю свободные варианты.',
    exact_slot_missing_date: 'Подскажите, пожалуйста, дату для этого времени — проверю свободные варианты.',
    exact_slot_missing_time: 'Подскажите, пожалуйста, точное время в формате 14:00.',
    exact_slot_invalid_time: 'Не смогла корректно понять время. Напишите, пожалуйста, в формате 14:00.',
    time_window_missing_or_invalid: 'Не смогла корректно понять время. Напишите, пожалуйста, в формате 14:00.',
    time_window_invalid_range: 'Вижу некорректный интервал времени. Напишите, пожалуйста, удобный промежуток ещё раз.',
    availability_date_in_past: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату — проверю свободные варианты.',
    exact_slot_date_in_past: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату и время.',
    booking_interest_missing_datetime: 'Подскажите, пожалуйста, удобный день и время.',
    off_topic: 'Могу помочь с вопросами клиники или записью на приём.',
    booking_error: 'Не удалось автоматически проверить запись. Администратор проверит вручную и свяжется с вами.',
    faq_address_missing: 'Подскажите, пожалуйста, по какому филиалу или адресу сориентировать?',
    faq_price_missing: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
    faq_insurance_missing: 'Подскажите, пожалуйста, какая у вас страховая или тип покрытия — проверим, можем ли принять.',
    post_booking_question: 'Вашу запись вижу в контексте. Напишите, пожалуйста, какой именно вопрос — помогу или передам администратору.',
    safe_fallback: 'Подскажите, пожалуйста, чем можем помочь — записью или вопросом по клинике?',
  },
  uk: {
    missing_service_for_availability: 'Підкажіть, будь ласка, на яку послугу або консультацію хочете записатися?',
    availability_query_unknown: 'Підкажіть, будь ласка, зручний день або час — перевірю доступні варіанти.',
    specific_date_missing_date: 'Підкажіть, будь ласка, конкретну дату — перевірю доступні варіанти.',
    exact_slot_missing_date: 'Підкажіть, будь ласка, дату для цього часу — перевірю доступні варіанти.',
    exact_slot_missing_time: 'Підкажіть, будь ласка, точний час у форматі 14:00.',
    exact_slot_invalid_time: 'Не змогла коректно зрозуміти час. Напишіть, будь ласка, у форматі 14:00.',
    time_window_missing_or_invalid: 'Не змогла коректно зрозуміти час. Напишіть, будь ласка, у форматі 14:00.',
    time_window_invalid_range: 'Бачу некоректний інтервал часу. Напишіть, будь ласка, зручний проміжок ще раз.',
    availability_date_in_past: 'Ця дата вже минула. Напишіть, будь ласка, майбутню дату — перевірю доступні варіанти.',
    exact_slot_date_in_past: 'Ця дата вже минула. Напишіть, будь ласка, майбутню дату й час.',
    booking_interest_missing_datetime: 'Підкажіть, будь ласка, зручний день і час.',
    off_topic: 'Можу допомогти з питаннями клініки або записом на прийом.',
    booking_error: 'Не вдалося автоматично перевірити запис. Адміністратор перевірить вручну і зв’яжеться з вами.',
    faq_address_missing: 'Підкажіть, будь ласка, щодо якої філії або адреси зорієнтувати?',
    faq_price_missing: 'Підкажіть, будь ласка, яка саме послуга цікавить — зорієнтую по вартості.',
    faq_insurance_missing: 'Підкажіть, будь ласка, яка у вас страхова або тип покриття — перевіримо, чи можемо прийняти.',
    post_booking_question: 'Ваш запис бачу в контексті. Напишіть, будь ласка, яке саме питання — допоможу або передам адміністратору.',
    safe_fallback: 'Підкажіть, будь ласка, чим можемо допомогти — записом чи питанням по клініці?',
  },
  cs: {
    missing_service_for_availability: 'Napište prosím, na jakou službu nebo konzultaci se chcete objednat.',
    availability_query_unknown: 'Napište prosím vhodný den nebo čas — ověřím volné možnosti.',
    specific_date_missing_date: 'Napište prosím konkrétní datum — ověřím volné možnosti.',
    exact_slot_missing_date: 'Napište prosím datum pro tento čas — ověřím volné možnosti.',
    exact_slot_missing_time: 'Napište prosím přesný čas ve formátu 14:00.',
    exact_slot_invalid_time: 'Čas jsem nerozuměla správně. Napište ho prosím ve formátu 14:00.',
    time_window_missing_or_invalid: 'Čas jsem nerozuměla správně. Napište ho prosím ve formátu 14:00.',
    time_window_invalid_range: 'Vidím neplatný časový interval. Napište prosím vhodný interval znovu.',
    availability_date_in_past: 'Toto datum už proběhlo. Napište prosím budoucí datum — ověřím volné možnosti.',
    exact_slot_date_in_past: 'Toto datum už proběhlo. Napište prosím budoucí datum a čas.',
    booking_interest_missing_datetime: 'Napište prosím vhodný den a čas.',
    off_topic: 'Mohu pomoci s dotazy ke klinice nebo objednáním.',
    booking_error: 'Objednání se nepodařilo automaticky ověřit. Administrátor to zkontroluje ručně a ozve se vám.',
    faq_address_missing: 'Napište prosím, s jakou pobočkou nebo adresou mám pomoci.',
    faq_price_missing: 'Napište prosím, o jakou službu jde — ověřím cenu.',
    faq_insurance_missing: 'Napište prosím pojišťovnu nebo typ krytí — ověříme, zda vás můžeme přijmout.',
    post_booking_question: 'Vaši objednávku vidím v kontextu. Napište prosím konkrétní dotaz — pomohu nebo předám administrátorovi.',
    safe_fallback: 'Napište prosím, s čím můžeme pomoci — objednáním nebo dotazem ke klinice?',
  },
  en: {
    missing_service_for_availability: 'Please tell me which service or consultation you would like to book.',
    availability_query_unknown: 'Please tell me a convenient day or time — I will check available options.',
    specific_date_missing_date: 'Please send a specific date — I will check available options.',
    exact_slot_missing_date: 'Please send the date for this time — I will check available options.',
    exact_slot_missing_time: 'Please send the exact time in 14:00 format.',
    exact_slot_invalid_time: 'I could not read the time correctly. Please write it in 14:00 format.',
    time_window_missing_or_invalid: 'I could not read the time correctly. Please write it in 14:00 format.',
    time_window_invalid_range: 'The time range looks invalid. Please send the preferred range again.',
    availability_date_in_past: 'That date has already passed. Please send a future date — I will check available options.',
    exact_slot_date_in_past: 'That date has already passed. Please send a future date and time.',
    booking_interest_missing_datetime: 'Please send a convenient day and time.',
    off_topic: 'I can help with clinic questions or booking an appointment.',
    booking_error: 'I could not check the booking automatically. An administrator will review it manually and contact you.',
    faq_address_missing: 'Please tell me which branch or address you need help with.',
    faq_price_missing: 'Please tell me which service you mean — I will check the price information.',
    faq_insurance_missing: 'Please tell me your insurance or coverage type — we will check whether we can accept it.',
    post_booking_question: 'I can see your booking in context. Please send the exact question — I will help or pass it to an administrator.',
    safe_fallback: 'Please tell me how we can help — booking or a clinic question?',
  },
};

export function runtimeReplyTemplate(language: RuntimeReplyLanguage, key: RuntimeReplyTemplateKey): string {
  return templates[language][key];
}
