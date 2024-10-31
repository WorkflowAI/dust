/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  ConversationMessageEmojiSelectorProps,
  ConversationMessageSizeType,
} from "@dust-tt/sparkle";
import { ConversationMessage, Markdown } from "@dust-tt/sparkle";
import type { LightWorkspaceType, UserMessageType } from "@dust-tt/types";
import {
  CiteBlock,
  getCiteDirective,
} from "@extension/components/markdown/CiteBlock";
import {
  MentionBlock,
  mentionDirective,
} from "@extension/components/markdown/MentionBlock";
import { useMemo } from "react";
import type { Components } from "react-markdown";
import type { PluggableList } from "react-markdown/lib/react-markdown";

interface UserMessageProps {
  citations?: React.ReactElement[];
  conversationId: string;
  isLastMessage: boolean;
  message: UserMessageType;
  messageEmoji?: ConversationMessageEmojiSelectorProps;
  owner: LightWorkspaceType;
  size: ConversationMessageSizeType;
}

export function UserMessage({
  citations,
  isLastMessage,
  message,
  messageEmoji,
  size,
}: UserMessageProps) {
  const additionalMarkdownComponents: Components = useMemo(
    () => ({
      sup: CiteBlock,
      mention: MentionBlock,
    }),
    []
  );

  const additionalMarkdownPlugins: PluggableList = useMemo(
    () => [getCiteDirective(), mentionDirective],
    []
  );

  return (
    <ConversationMessage
      pictureUrl={message.user?.image || message.context.profilePictureUrl}
      name={message.context.fullName}
      messageEmoji={messageEmoji}
      renderName={(name) => <div className="text-base font-medium">{name}</div>}
      type="user"
      citations={citations}
      size={size}
    >
      <div className="flex flex-col gap-4">
        <div>
          <Markdown
            content={message.content}
            isStreaming={false}
            isLastMessage={isLastMessage}
            additionalMarkdownComponents={additionalMarkdownComponents}
            additionalMarkdownPlugins={additionalMarkdownPlugins}
          />
        </div>
      </div>
    </ConversationMessage>
  );
}
