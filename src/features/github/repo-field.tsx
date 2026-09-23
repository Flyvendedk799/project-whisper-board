import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listGitHubRepos } from "@/lib/github.functions";

/** Pick a repository the server token can see, or type owner/name. */
export function GitHubRepoField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const repos = useQuery({
    queryKey: ["github", "repos"],
    queryFn: () => listGitHubRepos({ data: { page: 1, perPage: 50 } }),
    retry: false,
  });

  const known = repos.data?.repos ?? [];

  return (
    <div className="space-y-2">
      {known.length > 0 && (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={`${id}-picker`} aria-label="Choose a GitHub repository">
            <SelectValue placeholder="Choose a repository" />
          </SelectTrigger>
          <SelectContent>
            {known.map((repo) => (
              <SelectItem key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="owner/repo"
        autoComplete="off"
      />
    </div>
  );
}
