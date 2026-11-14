"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

/** Below 800px the header collapses into one menu button; Escape closes and returns focus. */
export function MobileNav({ links, current }: { links: Array<{ href: string; key: string; text: string }>; current?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return <div className="mobile-nav">
    <button ref={button} type="button" className="menu-btn" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(o => !o)}>
      {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}<span className="visually-hidden">{open ? "Close menu" : "Menu"}</span>
    </button>
    {open && <nav id="mobile-menu" aria-label="Main navigation" className="mobile-menu">
      {links.map(l => <Link key={l.key} href={l.href} aria-current={current === l.key ? "page" : undefined} onClick={() => setOpen(false)}>{l.text}</Link>)}
    </nav>}
  </div>;
}
