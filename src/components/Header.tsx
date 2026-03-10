import { Link } from "@tanstack/react-router";
import { FileText, Globe } from "lucide-react";
import { m } from "#/paraglide/messages";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-2 sm:px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-1.5 sm:gap-x-4 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-2 sm:px-3 py-1.5 text-sm text-[var(--ink)] no-underline shadow-[0_2px_8px_rgba(45,42,36,0.06)]"
          >
            <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,var(--academic-brown),var(--gold))]" />
            PicX
          </Link>
        </h2>

        <div className="flex items-center gap-x-1 sm:gap-x-2 md:gap-x-4 text-sm font-semibold overflow-x-auto scrollbar-hide">
          <Link
            to="/gallery"
            className="nav-link inline-flex items-center gap-1 sm:gap-1.5 flex-shrink-0"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Globe className="h-4 w-4" />
            <span className="hidden md:inline">{m.nav_explore()}</span>
          </Link>
          <Link
            to="/papers"
            className="nav-link inline-flex items-center gap-1 sm:gap-1.5 flex-shrink-0"
            activeProps={{ className: "nav-link is-active" }}
          >
            <FileText className="h-4 w-4" />
            <span className="hidden md:inline">{m.nav_papers()}</span>
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 md:gap-2 flex-shrink-0">
          <BetterAuthHeader />
          <ParaglideLocaleSwitcher />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
