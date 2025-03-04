import { proxyActivities } from "@temporalio/workflow";

import type * as activities from "@app/poke/temporal/activities";

// Create a single proxy with all activities
const activityProxies = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 minute",
});

const {
  deleteAgentsActivity,
  deleteAppsActivity,
  deleteTrackersActivity,
  deleteConversationsActivity,
  deleteMembersActivity,
  deleteRunOnDustAppsActivity,
  deleteSpacesActivity,
  deleteWorkspaceActivity,
  deleteTranscriptsActivity,
  isWorkflowDeletableActivity,
  scrubDataSourceActivity,
  scrubSpaceActivity,
} = activityProxies;

export async function scrubDataSourceWorkflow({
  dataSourceId,
  workspaceId,
}: {
  dataSourceId: string;
  workspaceId: string;
}) {
  await scrubDataSourceActivity({ dataSourceId, workspaceId });
}

export async function scrubSpaceWorkflow({
  spaceId,
  workspaceId,
}: {
  spaceId: string;
  workspaceId: string;
}) {
  await scrubSpaceActivity({ spaceId, workspaceId });
}

export async function deleteWorkspaceWorkflow({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const isDeletable = await isWorkflowDeletableActivity({ workspaceId });
  if (!isDeletable) {
    return;
  }
  await deleteConversationsActivity({ workspaceId });
  await deleteAgentsActivity({ workspaceId });
  await deleteRunOnDustAppsActivity({ workspaceId });
  await deleteAppsActivity({ workspaceId });
  await deleteTrackersActivity({ workspaceId });
  await deleteMembersActivity({ workspaceId });
  await deleteSpacesActivity({ workspaceId });
  await deleteTranscriptsActivity({ workspaceId });
  await deleteWorkspaceActivity({ workspaceId });
}
