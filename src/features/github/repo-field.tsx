import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/searchable-select";
import { useGitHubRepos } from "./use-github";
import { parseRepoSlug } from "@/lib/github-url";

/**
 * Pick one of your repositories (type to search the whole list) or type
 * owner/name yourself.
 */
export function GitHubRepoField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const repos = useGitHubRepos();
  const known = repos.data?.repos ?? [];

  return (
    <div className="space-y-2">
      {known.length > 0 || repos.isPending ? (
        <SearchableSelect
          id={`${id}-picker`}
          ariaLabel="Choose a GitHub repository"
          value={value}
          onChange={onChange}
          loading={repos.isPending}
          placeholder="Choose a repository"
          searchPlaceholder="Search your repositories"
          emptyText="No repository matches."
          allowCustom
          validateCustom={(text) => parseRepoSlug(text) !== null}
          options={known.map((repo) => ({
            value: repo.fullName,
            hint: repo.private ? "private" : undefined,
          }))}
        />
      ) : null}
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="owner/repo"
        autoComplete="off"
      />
      {repos.isError && (
        <p className="text-xs text-muted-foreground">
          Connect GitHub in Settings to pick from your repositories.
        </p>
      )}
      {repos.data?.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing your 500 most recently updated repositories. Type owner/name for any other.
        </p>
      ) : null}
    </div>
  );
}
