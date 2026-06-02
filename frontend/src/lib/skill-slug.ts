export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

export function slugBaseFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function makeSkillSlug(title: string, suffix: string): string {
  const base = slugBaseFromTitle(title);
  return base ? `${base}-${suffix}` : "";
}
