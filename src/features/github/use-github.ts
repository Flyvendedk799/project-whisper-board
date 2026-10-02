import { useQuery } from "@tanstack/react-query";
import { listAllGitHubRepos, listGitHubBranches } from "@/lib/github.functions";

/** The repositories the person can see, fetched once and shared by every picker. */
export function useGitHubRepos() {
  return useQuery({
    queryKey: ["github", "repos", "all"],
    queryFn: () => listAllGitHubRepos(),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Branches of `repo`, for the base and working-branch pickers. Off until a repository is set. */
export function useGitHubBranches(repo: string) {
  const slug = repo.trim();
  return useQuery({
    queryKey: ["github", "branches", slug],
    queryFn: () => listGitHubBranches({ data: { repo: slug } }),
    enabled: /^[\w.-]+\/[\w.-]+$/.test(slug),
    retry: false,
    staleTime: 60_000,
  });
}
