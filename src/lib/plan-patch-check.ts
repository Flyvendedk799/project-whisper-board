/** A delivery must contain every commit between the base and source tip, and nothing else. */
export function patchSetProblem(
  registered: string[],
  compare: string[],
  status: string,
  direct: boolean,
): string | null {
  if (direct && status !== "ahead")
    return "Direct delivery requires a branch that can fast-forward the base.";
  if (!direct && status !== "ahead" && status !== "diverged")
    return "This branch has no changes to propose.";
  if (compare.length > 250)
    return "The branch has too many commits for a patch bundle. Use a pull request directly.";
  const expected = new Set(registered.map((sha) => sha.toLowerCase()));
  const actual = new Set(compare.map((sha) => sha.toLowerCase()));
  if (expected.size !== actual.size || [...expected].some((sha) => !actual.has(sha))) {
    return "Register every commit on the source branch since the base, then select the full bundle.";
  }
  return null;
}
