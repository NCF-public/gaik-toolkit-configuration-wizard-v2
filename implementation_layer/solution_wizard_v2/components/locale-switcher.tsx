import Image from "next/image";
import { setLocale } from "@/app/locale-actions";
import { LOCALES, type Locale } from "@/lib/i18n";

/** Circle flags (HatScripts circle-flags, MIT) in public/flags/. */
const FLAG: Record<Locale, string> = { fi: "fi", en: "gb" };
/** Each language in its own name, as language pickers usually show them. */
const LANGUAGE: Record<Locale, string> = { fi: "Suomi", en: "English" };

// Locale switch fi/en. One form, two submit buttons; the clicked button's
// name/value goes to the server action. Works without client JS.
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  return (
    <form
      action={setLocale}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-muted p-0.5 text-xs font-medium"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          title={LANGUAGE[l]}
          aria-current={locale === l ? "true" : undefined}
          className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-colors ${
            locale === l ? "bg-surface text-text shadow-xs" : "text-text-muted hover:text-text"
          }`}
        >
          <Image
            src={`/flags/${FLAG[l]}.svg`}
            alt=""
            width={14}
            height={14}
            unoptimized
            className={`h-3.5 w-3.5 rounded-full ${locale === l ? "" : "opacity-70"}`}
          />
          {/* Flags alone on a phone; the code stays the button's name. */}
          <span className="max-sm:sr-only">{l.toUpperCase()}</span>
        </button>
      ))}
    </form>
  );
}
