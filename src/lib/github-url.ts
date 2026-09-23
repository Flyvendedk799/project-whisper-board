const REPO = /^([\w.-]+)\/([\w.-]+)$/;
const PULL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

export function parseRepoSlug(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(REPO);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function repoWebUrl(slug: string): string | null {
  const parsed = parseRepoSlug(slug);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

export function parsePullRequestUrl(
  value: string,
): { owner: string; repo: string; number: number } | null {
  const match = value.trim().match(PULL);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
