import "node-zendesk";

import type { ZendeskClientOptions } from "node-zendesk";

interface ZendeskFetchedBrand {
  url: string;
  id: number;
  name: string;
  brand_url: string;
  subdomain: string;
  host_mapping: string | null;
  has_help_center: boolean;
  help_center_state: string;
  active: boolean;
  default: boolean;
  is_deleted: boolean;
  logo: object | null;
  ticket_form_ids: number[];
  signature_template: string;
  created_at: string;
  updated_at: string;
}

interface Response {
  status: number;
  headers: object;
  statusText: string;
}

interface ZendeskFetchedCategory {
  id: number;
  url: string;
  html_url: string;
  position: number;
  created_at: string;
  updated_at: string;
  name: string;
  description: string;
  locale: string;
  source_locale: string;
  outdated: boolean;
}

export interface ZendeskFetchedArticle {
  id: number;
  url: string;
  html_url: string;
  author_id: number;
  comments_disabled: boolean;
  draft: boolean;
  promoted: boolean;
  position: number;
  vote_sum: number;
  vote_count: number;
  section_id: number;
  created_at: string;
  updated_at: string;
  name: string;
  title: string;
  source_locale: string;
  locale: string;
  outdated: boolean;
  outdated_locales: string[];
  edited_at: string;
  user_segment_id: number;
  permission_group_id: number;
  content_tag_ids: number[];
  label_names: string[];
  body: string;
  user_segment_ids: number[];
}

interface ZendeskFetchedTicket {
  assignee_id: number;
  collaborator_ids: number[];
  created_at: string; // ISO 8601 date string
  custom_fields: {
    id: number;
    value: string;
  }[];
  custom_status_id: number;
  description: string;
  due_at: string | null; // null or ISO 8601 date string
  external_id: string;
  follower_ids: number[];
  from_messaging_channel: boolean;
  generated_timestamp: number;
  group_id: number;
  has_incidents: boolean;
  id: number;
  organization_id: number;
  priority: string;
  problem_id: number;
  raw_subject: string;
  recipient: string;
  requester: { locale_id: number; name: string; email: string };
  requester_id: number;
  satisfaction_rating: {
    comment: string;
    id: number;
    score: string;
  };
  sharing_agreement_ids: number[];
  status: "new" | "open" | "pending" | "hold" | "solved" | "closed";
  subject: string;
  submitter_id: number;
  tags: string[];
  type: "problem" | "incident" | "question" | "task";
  updated_at: string; // ISO 8601 date string
  url: string;
  via: {
    channel: string;
  };
}

declare module "node-zendesk" {
  interface Client {
    config: ZendeskClientOptions;
    brand: {
      list: () => Promise<{
        response: Response;
        result: ZendeskFetchedBrand[];
      }>;
      show: (brandId: number) => Promise<{
        response: Response;
        result: { brand: ZendeskFetchedBrand };
      }>;
    };
    helpcenter: {
      categories: {
        list: () => Promise<ZendeskFetchedCategory[]>;
        show: (
          categoryId: number
        ) => Promise<{ response: Response; result: ZendeskFetchedCategory }>;
      };
      articles: {
        list: () => Promise<ZendeskFetchedArticle[]>;
        show: (
          articleId: number
        ) => Promise<{ response: Response; result: ZendeskFetchedArticle }>;
        listByCategory: (
          categoryId: number
        ) => Promise<ZendeskFetchedArticle[]>;
        listSinceStartTime: (
          startTime: number
        ) => Promise<ZendeskFetchedArticle[]>;
      };
    };
    tickets: {
      list: () => Promise<ZendeskFetchedTicket[]>;
      show: (
        ticketId: number
      ) => Promise<{ response: Response; result: ZendeskFetchedTicket }>;
    };
  }

  export function createClient(options: object): Client;
}
