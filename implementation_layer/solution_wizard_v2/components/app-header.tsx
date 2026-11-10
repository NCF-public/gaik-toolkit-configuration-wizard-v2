import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { Icon } from "@/components/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { Dict, Locale } from "@/lib/i18n";

/**
 * The one header every signed-in page uses, with the GAIK mark from the
 * project's logo files. The list and the session view used to name and draw
 * the product differently ("GAIK Solution Wizard" with a blue square, "GAIK
 * Wizard" with a drawn hexagon).
 */
export function AppHeader({
  locale,
  t,
  email,
  privacyLink = false,
  children,
}: {
  locale: Locale;
  t: Dict;
  email?: string;
  /** Show the privacy notice link (the session list does). */
  privacyLink?: boolean;
  /** What follows the product name: the page's own crumbs and title. */
  children?: ReactNode;
}) {
  return (
    <header className="app-header z-20 gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-md text-text hover:text-text-strong"
        >
          <Image
            src="/gaik-mark.png"
            alt=""
            width={133}
            height={96}
            priority
            unoptimized
            className="h-[22px] w-auto"
          />
          <span className="text-[15px] font-semibold tracking-tight">
            GAIK <span className="hidden font-normal text-text-secondary sm:inline">Solution Wizard</span>
          </span>
        </Link>
        {children && (
          <>
            <span className="h-4 w-px shrink-0 bg-border-strong" aria-hidden />
            <div className="flex min-w-0 items-center gap-2">{children}</div>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm text-text-secondary">
        <LocaleSwitcher locale={locale} />
        {privacyLink && (
          <Link
            href="/privacy"
            data-testid="privacy-link"
            title={t.privacyLink}
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-text-muted transition-colors hover:text-text"
          >
            {/* An icon on a phone, where the header has no room for the words. */}
            <Icon name="info" size={16} className="md:hidden" />
            <span className="max-md:sr-only">{t.privacyLink}</span>
          </Link>
        )}
        {email && <span className="hidden text-text-muted md:inline">{email}</span>}
        {email && (
          <form action={signOut}>
            <button
              type="submit"
              title={t.signOut}
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              <Icon name="logOut" size={16} className="sm:hidden" />
              <span className="max-sm:sr-only">{t.signOut}</span>
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
