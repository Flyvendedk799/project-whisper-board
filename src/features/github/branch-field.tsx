import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/searchable-select";
import { useGitHubBranches } from "./use-github";
import { isValidBranchName } from "@/lib/plan-fields";

/**
 * A branch of the repository: pick one (searchable) or type a name. Without a
 * repository, or when GitHub cannot be read, it falls back to a plain text
 * field so nothing is ever blocked on the lookup.
 */
export function BranchField({
  id,
  repo,
  value,
  onChange,
  placeholder = "main",
  ariaLabel,
  /** Only offer branches that exist. Leave off to type a name for a branch yet to be made. */
  existingOnly = false,
}: {
  id: string;
  repo: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  existingOnly?: boolean;
}) {
  const branches = useGitHubBranches(repo);
  const list = branches.data?.branches ?? [];

  if (list.length === 0 && !branches.isPending) {
    return (
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
      />
    );
  }

  return (
    <SearchableSelect
      id={id}
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      loading={branches.isPending && branches.fetchStatus !== "idle"}
      placeholder={placeholder}
      searchPlaceholder="Search branches"
      emptyText="No branch matches."
      allowCustom={!existingOnly}
      validateCustom={isValidBranchName}
      options={list.map((branch) => ({
        value: branch.name,
        hint:
          branch.name === branches.data?.defaultBranch
            ? "default"
            : branch.protected
              ? "protected"
              : undefined,
      }))}
    />
  );
}
