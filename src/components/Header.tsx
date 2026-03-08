import { Link } from "@tanstack/react-router";
import { Coins, FileText, Key } from "lucide-react";
import { m } from "#/paraglide/messages";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-4 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 text-sm text-[var(--ink)] no-underline shadow-[0_2px_8px_rgba(45,42,36,0.06)]"
          >
            <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,var(--academic-brown),var(--gold))]" />
            PicX
          </Link>
        </h2>

        <div className="flex items-center gap-x-2 text-sm font-semibold sm:gap-x-4">
          <Link
            to="/papers"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">{m.nav_papers()}</span>
          </Link>
          <Link
            to="/credits"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Coins className="h-4 w-4" />
            <span className="hidden sm:inline">{m.nav_credits()}</span>
          </Link>
          <Link
            to="/api-configs"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Key className="h-4 w-4" />
            <span className="hidden sm:inline">{m.nav_api_configs()}</span>
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <BetterAuthHeader />
          <ParaglideLocaleSwitcher />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
