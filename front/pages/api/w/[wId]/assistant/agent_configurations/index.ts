import type {
  AgentActionConfigurationType,
  AgentConfigurationType,
  LightAgentConfigurationType,
  Result,
  WithAPIErrorResponse,
} from "@dust-tt/types";
import {
  assertNever,
  Err,
  GetAgentConfigurationsQuerySchema,
  Ok,
  PostOrPatchAgentConfigurationRequestBodySchema,
} from "@dust-tt/types";
import { isLeft } from "fp-ts/lib/Either";
import type * as t from "io-ts";
import * as reporter from "io-ts-reporters";
import _ from "lodash";
import type { NextApiRequest, NextApiResponse } from "next";

import { getApp } from "@app/lib/api/app";
import { getAgentsUsage } from "@app/lib/api/assistant/agent_usage";
import {
  createAgentActionConfiguration,
  createAgentConfiguration,
  getAgentConfigurations,
  unsafeHardDeleteAgentConfiguration,
} from "@app/lib/api/assistant/configuration";
import { getAgentsRecentAuthors } from "@app/lib/api/assistant/recent_authors";
import { withSessionAuthenticationForWorkspace } from "@app/lib/api/wrappers";
import type { Authenticator } from "@app/lib/auth";
import { safeRedisClient } from "@app/lib/redis";
import { ServerSideTracking } from "@app/lib/tracking/server";
import { apiError } from "@app/logger/withlogging";

export type GetAgentConfigurationsResponseBody = {
  agentConfigurations: LightAgentConfigurationType[];
};
export type PostAgentConfigurationResponseBody = {
  agentConfiguration: LightAgentConfigurationType;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    WithAPIErrorResponse<
      | GetAgentConfigurationsResponseBody
      | PostAgentConfigurationResponseBody
      | void
    >
  >,
  auth: Authenticator
): Promise<void> {
  const owner = auth.getNonNullableWorkspace();

  switch (req.method) {
    case "GET":
      if (!auth.isUser()) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "app_auth_error",
            message: "Only the workspace users can see Assistants.",
          },
        });
      }
      // extract the view from the query parameters
      const queryValidation = GetAgentConfigurationsQuerySchema.decode({
        ...req.query,
        limit:
          typeof req.query.limit === "string"
            ? parseInt(req.query.limit, 10)
            : undefined,
      });
      if (isLeft(queryValidation)) {
        const pathError = reporter.formatValidationErrors(queryValidation.left);
        return apiError(req, res, {
          status_code: 400,
          api_error: {
            type: "invalid_request_error",
            message: `Invalid query parameters: ${pathError}`,
          },
        });
      }

      const { view, conversationId, limit, withUsage, withAuthors, sort } =
        queryValidation.right;
      const viewParam = view
        ? view
        : conversationId
          ? { conversationId }
          : "all";
      if (viewParam === "admin_internal" && !auth.isDustSuperUser()) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "app_auth_error",
            message: "Only Dust Super Users can see admin_internal agents.",
          },
        });
      }
      let agentConfigurations = await getAgentConfigurations({
        auth,
        agentsGetView: viewParam,
        variant: "light",
        limit,
        sort,
      });
      if (withUsage === "true") {
        const mentionCounts = await safeRedisClient(async (redis) => {
          return getAgentsUsage({
            providedRedis: redis,
            workspaceId: owner.sId,
            limit:
              typeof req.query.limit === "string"
                ? parseInt(req.query.limit, 10)
                : -1,
          });
        });
        const usageMap = _.keyBy(mentionCounts, "agentId");
        agentConfigurations = agentConfigurations.map((agentConfiguration) => ({
          ...agentConfiguration,
          usage: {
            messageCount: usageMap[agentConfiguration.sId]?.messageCount || 0,
            timePeriodSec: usageMap[agentConfiguration.sId]?.timePeriodSec || 0,
          },
        }));
      }
      if (withAuthors === "true") {
        const recentAuthors = await getAgentsRecentAuthors({
          auth,
          agents: agentConfigurations,
        });
        agentConfigurations = await Promise.all(
          agentConfigurations.map(
            async (
              agentConfiguration,
              index
            ): Promise<LightAgentConfigurationType> => {
              return {
                ...agentConfiguration,
                lastAuthors: recentAuthors[index],
              };
            }
          )
        );
      }

      return res.status(200).json({
        agentConfigurations,
      });
    case "POST":
      if (!auth.isUser()) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "app_auth_error",
            message: "Only users of the workspace can create assistants.",
          },
        });
      }

      const bodyValidation =
        PostOrPatchAgentConfigurationRequestBodySchema.decode(req.body);
      if (isLeft(bodyValidation)) {
        const pathError = reporter.formatValidationErrors(bodyValidation.left);
        return apiError(req, res, {
          status_code: 400,
          api_error: {
            type: "invalid_request_error",
            message: `Invalid request body: ${pathError}`,
          },
        });
      }
      if (
        bodyValidation.right.assistant.scope === "workspace" &&
        !auth.isBuilder()
      ) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "app_auth_error",
            message: "Only builders can create workspace assistants.",
          },
        });
      }

      const maxToolsUsePerRun =
        bodyValidation.right.assistant.maxToolsUsePerRun;

      const isLegacyConfiguration =
        bodyValidation.right.assistant.actions.length === 1 &&
        !bodyValidation.right.assistant.actions[0].description;

      if (isLegacyConfiguration && maxToolsUsePerRun !== undefined) {
        return apiError(req, res, {
          status_code: 400,
          api_error: {
            type: "app_auth_error",
            message:
              "maxToolsUsePerRun is only supported in multi-actions mode.",
          },
        });
      }
      if (!isLegacyConfiguration && maxToolsUsePerRun === undefined) {
        return apiError(req, res, {
          status_code: 400,
          api_error: {
            type: "app_auth_error",
            message: "maxToolsUsePerRun is required in multi-actions mode.",
          },
        });
      }
      const agentConfigurationRes = await createOrUpgradeAgentConfiguration({
        auth,
        assistant: { ...bodyValidation.right.assistant, maxToolsUsePerRun },
      });

      if (agentConfigurationRes.isErr()) {
        return apiError(req, res, {
          status_code: 500,
          api_error: {
            type: "assistant_saving_error",
            message: `Error saving assistant: ${agentConfigurationRes.error.message}`,
          },
        });
      }

      return res.status(200).json({
        agentConfiguration: agentConfigurationRes.value,
      });

    default:
      return apiError(req, res, {
        status_code: 405,
        api_error: {
          type: "method_not_supported_error",
          message:
            "The method passed is not supported, GET OR POST is expected.",
        },
      });
  }
}

export default withSessionAuthenticationForWorkspace(handler);

/**
 * Create Or Upgrade Agent Configuration If an agentConfigurationId is provided, it will create a
 * new version of the agent configuration with the same agentConfigurationId. If no
 * agentConfigurationId is provided, it will create a new agent configuration. In both cases, it
 * will return the new agent configuration.
 **/
export async function createOrUpgradeAgentConfiguration({
  auth,
  assistant,
  agentConfigurationId,
}: {
  auth: Authenticator;
  assistant: t.TypeOf<
    typeof PostOrPatchAgentConfigurationRequestBodySchema
  >["assistant"];
  agentConfigurationId?: string;
}): Promise<Result<AgentConfigurationType, Error>> {
  const { actions } = assistant;

  const maxToolsUsePerRun = assistant.maxToolsUsePerRun ?? actions.length;

  // Tools mode:
  // Enforce that every action has a name and a description and that every name is unique.
  if (actions.length > 1) {
    const actionsWithoutName = actions.filter((action) => !action.name);
    if (actionsWithoutName.length) {
      return new Err(
        Error(
          `Every action must have a name. Missing names for: ${actionsWithoutName
            .map((action) => action.type)
            .join(", ")}`
        )
      );
    }
    const actionNames = new Set<string>();
    for (const action of actions) {
      if (!action.name) {
        // To please the type system.
        throw new Error(`unreachable: action.name is required.`);
      }
      if (actionNames.has(action.name)) {
        return new Err(new Error(`Duplicate action name: ${action.name}`));
      }
      actionNames.add(action.name);
    }
    const actionsWithoutDesc = actions.filter((action) => !action.description);
    if (actionsWithoutDesc.length) {
      return new Err(
        Error(
          `Every action must have a description. Missing names for: ${actionsWithoutDesc
            .map((action) => action.type)
            .join(", ")}`
        )
      );
    }
  }

  const agentConfigurationRes = await createAgentConfiguration(auth, {
    name: assistant.name,
    description: assistant.description,
    instructions: assistant.instructions ?? null,
    maxToolsUsePerRun,
    pictureUrl: assistant.pictureUrl,
    status: assistant.status,
    scope: assistant.scope,
    model: assistant.model,
    agentConfigurationId,
    templateId: assistant.templateId ?? null,
  });

  if (agentConfigurationRes.isErr()) {
    return agentConfigurationRes;
  }

  const actionConfigs: AgentActionConfigurationType[] = [];

  for (const action of actions) {
    if (action.type === "retrieval_configuration") {
      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "retrieval_configuration",
          query: action.query,
          relativeTimeFrame: action.relativeTimeFrame,
          topK: action.topK,
          dataSources: action.dataSources,
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else if (action.type === "dust_app_run_configuration") {
      const app = await getApp(auth, action.appId);
      if (!app) {
        return new Err(new Error(`App ${action.appId} not found`));
      }

      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "dust_app_run_configuration",
          app,
          appWorkspaceId: action.appWorkspaceId,
          appId: action.appId,
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else if (action.type === "tables_query_configuration") {
      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "tables_query_configuration",
          tables: action.tables,
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else if (action.type === "process_configuration") {
      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "process_configuration",
          dataSources: action.dataSources,
          relativeTimeFrame: action.relativeTimeFrame,
          tagsFilter: action.tagsFilter,
          schema: action.schema,
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else if (action.type === "websearch_configuration") {
      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "websearch_configuration",
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else if (action.type === "browse_configuration") {
      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "browse_configuration",
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else if (action.type === "visualization_configuration") {
      const res = await createAgentActionConfiguration(
        auth,
        {
          type: "visualization_configuration",
          name: action.name ?? null,
          description: action.description ?? null,
        },
        agentConfigurationRes.value
      );
      if (res.isErr()) {
        // If we fail to create an action, we should delete the agent configuration
        // we just created and re-throw the error.
        await unsafeHardDeleteAgentConfiguration(agentConfigurationRes.value);
        return res;
      }
      actionConfigs.push(res.value);
    } else {
      assertNever(action);
    }
  }

  const agentConfiguration: AgentConfigurationType = {
    ...agentConfigurationRes.value,
    actions: actionConfigs,
  };

  // We are not tracking draft agents
  if (agentConfigurationRes.value.status === "active") {
    void ServerSideTracking.trackAssistantCreated({
      user: auth.user() ?? undefined,
      workspace: auth.workspace() ?? undefined,
      assistant: agentConfiguration,
    });
  }

  return new Ok(agentConfiguration);
}
