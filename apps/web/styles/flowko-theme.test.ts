import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = join(__dirname, "..");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

const css = read("styles/flowko-theme.css");

const VALUES: Record<string, string> = {
  "--cal-bg-muted": "#FCF8FF",
  "--cal-bg-subtle": "#F5F0FF",
  "--cal-bg-emphasis": "#E8E0F5",
  "--cal-border": "#D9CFEA",
  "--cal-border-subtle": "#E8E0F5",
  "--cal-border-muted": "#F5F0FF",
  "--cal-border-emphasis": "#B9AEDF",
  "--cal-text-emphasis": "#1A1A2E",
  "--cal-text": "#33334D",
  "--cal-text-subtle": "#6B6B8A",
  "--cal-text-muted": "#83839E",
  "--cal-bg-primary": "#7A3FD1",
  "--cal-bg-primary-emphasis": "#6A31BF",
  "--cal-brand": "#7A3FD1",
  "--cal-brand-emphasis": "#6A31BF",
  // Flowko U29f: R10, the booking blocks' second tone (pale lilac), never Cal's grey fallback.
  "--cal-brand-subtle": "#DECFF4",
  "--cal-brand-text": "#FFFFFF",
};

describe("flowko-theme.css (Flowko U14)", () => {
  it("declares its values under :root:not(.dark), and in .dark only the brand, so tokens.css's .dark still wins", () => {
    const blocks = Array.from(css.matchAll(/([^{}]+)\{[^{}]*--cal-[^{}]*\}/g)).map((block) =>
      block[1].replace(/\/\*[\s\S]*?\*\//g, "").trim()
    );
    expect(blocks).toEqual([":root:not(.dark)", ".dark"]);
    const dark = css.match(/\n\.dark \{([^{}]*)\}/)?.[1] ?? "";
    expect(Array.from(dark.matchAll(/(--[\w-]+):/g)).map((match) => match[1])).toEqual([
      "--cal-brand",
      "--cal-brand-emphasis",
      "--cal-brand-subtle", // Flowko U29f: R10
      "--cal-brand-text",
    ]);
  });

  // Flowko U29f: R10 — the dark second tone is the value useCalcomTheme sets inline (#674099).
  it("declares the dark booking tone --cal-brand-subtle: #674099 in .dark", () => {
    const dark = css.match(/\n\.dark \{([^{}]*)\}/)?.[1] ?? "";
    expect(dark).toMatch(/--cal-brand-subtle:\s*#674099;/i);
  });

  it("gives the coss Button the brand", () => {
    expect(css).toMatch(/--primary:\s*var\(--cal-brand\);/);
    expect(css).toMatch(/--primary-foreground:\s*var\(--cal-brand-text\);/);
  });

  it.each(Object.entries(VALUES))("%s is %s", (name, value) => {
    expect(css).toMatch(new RegExp(`${name}:\\s*${value};`, "i"));
  });

  it.each(["default", "hover", "active", "focused"])("the brand button's %s shadow is purple", (state) => {
    expect(css).toMatch(
      new RegExp(`--shadow-button-solid-brand-${state}:[^;]*rgba\\(122, 63, 209, 0\\.28\\)[^;]*;`)
    );
  });

  it("leaves the radius alone", () => {
    expect(css).not.toContain("--radius");
  });

  it("stays out of tokens.css, which is compiled into embed.js", () => {
    const tokens = read("../../packages/config/theme/tokens.css");
    expect(tokens.toLowerCase()).not.toContain("7a3fd1");
  });

  it.each(["app/(use-page-wrapper)/layout.tsx", "app/not-found.tsx", "app/error.tsx", "app/global-error.tsx"])(
    "%s loads it",
    (path) => {
      expect(read(path)).toMatch(/import ".*styles\/flowko-theme\.css";/);
    }
  );

  it.each(["app/layout.tsx", "app/(booking-page-wrapper)/layout.tsx"])(
    "%s does not load it, so a first load of a booking page or an embed stays neutral",
    (path) => {
      expect(read(path)).not.toContain("flowko-theme");
    }
  );
});

describe("the sign-in page (Flowko U14)", () => {
  it("loads the first screen in full after signing in, so it is in the account's language", () => {
    const login = read("modules/auth/login-view.tsx");
    expect(login).toContain("window.location.assign(callbackUrl)");
    expect(login).not.toContain("router.push(callbackUrl)");
  });

  it("shows the logo, and keeps the product's name for screen readers", () => {
    const login = read("modules/auth/login-view.tsx");
    expect(login).toMatch(/<h1 className="logo[^"]*">\s*<img[^>]*alt=\{APP_NAME\}[^>]*src="\/api\/logo"/);
  });
});

describe("the app's font (Flowko U14)", () => {
  const layout = read("app/layout.tsx");

  it("is Plus Jakarta Sans, with Slovene letters, for both font variables", () => {
    expect(layout).toContain('import { Plus_Jakarta_Sans } from "next/font/google"');
    expect(layout).toMatch(/subsets: \["latin", "latin-ext"\]/);
    expect(layout).toMatch(/--font-sans: \$\{jakartaFont\./);
    expect(layout).toMatch(/--font-cal: \$\{jakartaFont\./);
  });

  it("no longer loads Inter or Cal Sans", () => {
    expect(layout).not.toMatch(/\bInter\b/);
    expect(layout).not.toContain("CalSans");
  });
});
