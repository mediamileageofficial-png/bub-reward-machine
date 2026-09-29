import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "dark" | "ghost" | "light";

const styles: Record<Variant, string> = {
  primary: "bg-bub-orange text-bub-ink hover:bg-bub-orange-deep active:bg-bub-orange-deep",
  dark: "bg-bub-ink text-bub-white border-2 border-bub-ink hover:bg-black",
  ghost: "bg-transparent text-bub-ink border-2 border-bub-ink/30 hover:border-bub-ink",
  light: "bg-bub-card text-bub-ink border-2 border-bub-line hover:border-bub-ink",
};

const base =
  "font-display cut-br inline-flex min-h-14 w-full items-center justify-center gap-2 px-6 text-xl tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bub-ink";

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "primary", className = "", children, external }: { href: string; variant?: Variant; className?: string; children: ReactNode; external?: boolean }) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${base} ${styles[variant]} ${className}`}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="square" />
    </svg>
  );
}
