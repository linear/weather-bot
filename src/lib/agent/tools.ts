/**
 * Trigger the "Estimate Issue" GitHub Actions workflow for a Linear issue.
 *
 * Fires a `repository_dispatch` event of type `pug-estimate` at the given
 * repository (the iOS app or the server backend — both answer the same event;
 * the caller picks which by passing the matching `repo`). The workflow (on the
 * repo's default branch) is the single entry point for the automation: it
 * validates the Linear issue, posts an "estimating" status note and a triage
 * summary as comments on the Linear issue, and applies `complexity:` /
 * `effort:` / `autonomy:` labels. On the iOS repo, when the verdict is
 * ai-can-fix it chains straight into the automated fix that opens a pull
 * request; the server workflow is scope-only (it estimates but does not open a
 * PR automatically).
 *
 * Re-dispatching the same issue is safe and intentional: the workflow
 * serializes runs per Linear issue, and re-running (e.g. after answering
 * clarifying questions, or after removing the `autonomy:needs-human` label to
 * override a verdict) makes the new run read the full Linear thread.
 *
 * Note: GitHub answers a dispatch with 204 No Content and gives no feedback
 * about whether the workflow's own guard accepts the payload — so the caller
 * must validate `linearIssueId` before calling this.
 *
 * @param params.token - A GitHub token with contents:write on the repo
 * @param params.repo - The target repository as "owner/repo"
 * @param params.linearIssueId - The Linear issue identifier (e.g. "ZES-123")
 * @param params.instruction - Optional free-text note from the agent session,
 *   passed to the triage agent as requester context (may be empty)
 * @returns A success message, or an error string
 */
export const triggerEstimateWorkflow = async (params: {
  token: string;
  repo: string;
  linearIssueId: string;
  instruction: string;
}): Promise<string> => {
  const { token, repo, linearIssueId, instruction } = params;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `https://api.github.com/repos/${repo}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "puglet-linear-agent",
        },
        body: JSON.stringify({
          event_type: "pug-estimate",
          client_payload: {
            linear_issue: linearIssueId,
            instruction,
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    // A successful dispatch is 204 No Content — there is no body to parse.
    if (!response.ok) {
      const errorText = await response.text();
      return `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`;
    }

    return `Estimate workflow triggered for ${linearIssueId}. The workflow will post its triage summary as a comment on the Linear issue shortly.`;
  } catch (error) {
    return `Failed to trigger the estimate workflow: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
  }
};
