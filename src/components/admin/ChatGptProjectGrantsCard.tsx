/*
 * Admin: grant a writer a shared ChatGPT project.
 * The upstream ChatGPT account accepts the collaborator invite first; the
 * admin then pastes the project link here. The writer sees every chat in the
 * project, and every other writer stops seeing it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminGrantChatGptProject,
  adminListChatGptProjectGrants,
  adminRevokeChatGptProject,
} from "@/lib/chatgpt-controls.functions";

type Account = "account_1" | "account_2";

export function ChatGptProjectGrantsCard({
  userId,
  defaultAccount,
}: {
  userId: string;
  defaultAccount: Account;
}) {
  const qc = useQueryClient();
  const key = ["admin-chatgpt-project-grants", userId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => adminListChatGptProjectGrants({ data: { userId } }),
  });
  const [project, setProject] = useState("");
  const [name, setName] = useState("");
  const [account, setAccount] = useState<Account>(defaultAccount);

  const grant = useMutation({
    mutationFn: () =>
      adminGrantChatGptProject({
        data: { userId, provider_account_key: account, project, project_name: name || undefined },
      }),
    onSuccess: () => {
      toast.success("Project granted. Other writers no longer see it.");
      setProject("");
      setName("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (row: { provider_account_key: Account; project_id: string }) =>
      adminRevokeChatGptProject({ data: { userId, ...row } }),
    onSuccess: () => {
      toast.success("Project access removed");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-6 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Shared ChatGPT projects
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Accept the collaborator invite on the ChatGPT account first, then paste the project link
        here. This writer will see every chat in the project, and it will be hidden from all other
        writers.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
        <div>
          <Label htmlFor="chatgpt-project-link">Project link</Label>
          <Input
            id="chatgpt-project-link"
            placeholder="https://chatgpt.com/g/g-p-…/project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="chatgpt-project-name">Name (optional)</Label>
          <Input
            id="chatgpt-project-name"
            placeholder="e.g. Client thesis"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="chatgpt-project-account">Account</Label>
          <select
            id="chatgpt-project-account"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={account}
            onChange={(e) => setAccount(e.target.value as Account)}
          >
            <option value="account_1">Account 1</option>
            <option value="account_2">Account 2</option>
          </select>
        </div>
      </div>
      <Button
        className="mt-3"
        size="sm"
        disabled={!project.trim() || grant.isPending}
        onClick={() => grant.mutate()}
      >
        {grant.isPending ? "Granting…" : "Grant project"}
      </Button>

      <div className="mt-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading projects…</p>
        ) : error ? (
          <p className="text-xs text-destructive">{(error as Error).message}</p>
        ) : !data?.length ? (
          <p className="text-xs text-muted-foreground">
            No shared projects granted to this writer.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {data.map((row) => (
              <li
                key={row.provider_account_key + row.project_id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{row.project_name || row.project_id}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.project_id} ·{" "}
                    {row.provider_account_key === "account_2" ? "Account 2" : "Account 1"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate({
                      provider_account_key: row.provider_account_key,
                      project_id: row.project_id,
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
