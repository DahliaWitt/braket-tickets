export type AnalyticsEnvironment =
  | 'production'
  | 'preview'
  | 'development'
  | 'test'
  | 'e2e';

export type EventVisibility = 'private' | 'public_viewable' | 'public';
export type PurchaseAccessSource =
  | 'open_access'
  | 'direct'
  | 'shared'
  | 'denied';
export type CheckoutKind = 'primary' | 'guest' | 'free' | 'resale';

export type FeedbackCategory =
  | 'general_feedback'
  | 'bug'
  | 'feature_request'
  | 'payment'
  | 'event_info'
  | 'organizer'
  | 'other';

export interface AnalyticsEventMap {
  event_viewed: {
    event_id: string;
    organizer_id?: string;
    event_visibility?: EventVisibility;
    purchase_access_source?: PurchaseAccessSource;
  };
  checkout_panel_opened: {
    event_id: string;
    checkout_kind: CheckoutKind;
    ticket_count?: number;
    tier?: string;
  };
  stripe_checkout_mounted: {
    order_id: string;
    event_id: string;
    checkout_kind: CheckoutKind;
  };
  stripe_connect_onboarding_started: {
    organizer_id: string;
    connected_account_present: boolean;
  };
  feedback_submitted: {
    feedback_category: FeedbackCategory;
    feedback_message: string;
    feedback_replay_url?: string;
    message_length: number;
    route_template: string;
    signed_in: boolean;
    has_replay_url: boolean;
  };
  trust_link_created: {
    organizer_id?: string;
    community_id?: string;
    source?: string;
    trustingOrganizerId?: string;
    trustedOrganizerId?: string;
  };
  trust_link_removed: {
    organizer_id?: string;
    community_id?: string;
    source?: string;
    trustingOrganizerId?: string;
    trustedOrganizerId?: string;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;
