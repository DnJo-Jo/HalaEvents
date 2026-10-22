export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_plans: {
        Row: {
          ai_run_id: string | null;
          assumptions: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          event_id: string;
          id: string;
          input_hash: string;
          is_mock: boolean;
          playbook_id: string;
          playbook_version: number;
          source: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          ai_run_id?: string | null;
          assumptions?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          event_id: string;
          id?: string;
          input_hash: string;
          is_mock?: boolean;
          playbook_id: string;
          playbook_version: number;
          source: string;
          status?: string;
        };
        Update: {
          ai_run_id?: string | null;
          assumptions?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          event_id?: string;
          id?: string;
          input_hash?: string;
          is_mock?: boolean;
          playbook_id?: string;
          playbook_version?: number;
          source?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_plans_ai_run_id_fkey";
            columns: ["ai_run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_plans_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_runs: {
        Row: {
          attempts: number;
          created_at: string;
          created_by: string | null;
          error_code: string | null;
          event_id: string;
          finished_at: string | null;
          id: string;
          input_hash: string;
          input_tokens: number | null;
          is_mock: boolean;
          latency_ms: number | null;
          model: string;
          output_tokens: number | null;
          pipeline: string;
          provider: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          created_at?: string;
          created_by?: string | null;
          error_code?: string | null;
          event_id: string;
          finished_at?: string | null;
          id?: string;
          input_hash: string;
          input_tokens?: number | null;
          is_mock?: boolean;
          latency_ms?: number | null;
          model: string;
          output_tokens?: number | null;
          pipeline: string;
          provider: string;
          status?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          created_by?: string | null;
          error_code?: string | null;
          event_id?: string;
          finished_at?: string | null;
          id?: string;
          input_hash?: string;
          input_tokens?: number | null;
          is_mock?: boolean;
          latency_ms?: number | null;
          model?: string;
          output_tokens?: number | null;
          pipeline?: string;
          provider?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_runs_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_suggestions: {
        Row: {
          ai_run_id: string | null;
          created_at: string;
          created_by: string | null;
          decided_at: string | null;
          decided_by: string | null;
          event_id: string;
          id: string;
          is_mock: boolean;
          item_key: string;
          kind: string;
          payload: NonNullable<Json>;
          plan_id: string | null;
          revision: number;
          source: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          ai_run_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          event_id: string;
          id?: string;
          is_mock?: boolean;
          item_key: string;
          kind: string;
          payload: NonNullable<Json>;
          plan_id?: string | null;
          revision?: number;
          source: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          ai_run_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          event_id?: string;
          id?: string;
          is_mock?: boolean;
          item_key?: string;
          kind?: string;
          payload?: NonNullable<Json>;
          plan_id?: string | null;
          revision?: number;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_ai_run_id_fkey";
            columns: ["ai_run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_suggestions_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_suggestions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "ai_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      approvals: {
        Row: {
          action_type: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          event_id: string;
          executed_at: string | null;
          executed_by: string | null;
          execution_started_at: string | null;
          failure_reason: string | null;
          id: string;
          payload: NonNullable<Json>;
          payload_hash: string;
          recipient_summary: string;
          requested_at: string;
          requested_by: string | null;
          result: Json | null;
          status: string;
          target_id: string;
          approval_payload_unchanged: boolean | null;
        };
        ComputedFields: "approval_payload_unchanged";
        Insert: {
          action_type: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          event_id: string;
          executed_at?: string | null;
          executed_by?: string | null;
          execution_started_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          payload: NonNullable<Json>;
          payload_hash: string;
          recipient_summary: string;
          requested_at?: string;
          requested_by?: string | null;
          result?: Json | null;
          status?: string;
          target_id: string;
        };
        Update: {
          action_type?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          event_id?: string;
          executed_at?: string | null;
          executed_by?: string | null;
          execution_started_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          payload?: NonNullable<Json>;
          payload_hash?: string;
          recipient_summary?: string;
          requested_at?: string;
          requested_by?: string | null;
          result?: Json | null;
          status?: string;
          target_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      attendees: {
        Row: {
          application_note: string | null;
          checked_in_at: string | null;
          confirmed_at: string | null;
          consent_at: string | null;
          created_at: string;
          decision_reason: string | null;
          email: string;
          event_id: string;
          full_name: string;
          id: string;
          participation_status: string;
          phone: string | null;
          registered_at: string | null;
          registration_status: string;
          review_status: string;
          source: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          application_note?: string | null;
          checked_in_at?: string | null;
          confirmed_at?: string | null;
          consent_at?: string | null;
          created_at?: string;
          decision_reason?: string | null;
          email: string;
          event_id: string;
          full_name: string;
          id?: string;
          participation_status?: string;
          phone?: string | null;
          registered_at?: string | null;
          registration_status: string;
          review_status: string;
          source: string;
          updated_at?: string;
        };
        Update: {
          application_note?: string | null;
          checked_in_at?: string | null;
          confirmed_at?: string | null;
          consent_at?: string | null;
          created_at?: string;
          decision_reason?: string | null;
          email?: string;
          event_id?: string;
          full_name?: string;
          id?: string;
          participation_status?: string;
          phone?: string | null;
          registered_at?: string | null;
          registration_status?: string;
          review_status?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendees_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_kind: string;
          actor_user_id: string | null;
          after: Json | null;
          at: string;
          before: Json | null;
          entity_id: string;
          entity_type: string;
          event_id: string | null;
          id: number;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_kind: string;
          actor_user_id?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          entity_id: string;
          entity_type: string;
          event_id?: string | null;
          id?: never;
        };
        Update: {
          action?: string;
          actor_kind?: string;
          actor_user_id?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          entity_id?: string;
          entity_type?: string;
          event_id?: string | null;
          id?: never;
        };
        Relationships: [];
      };
      bookings: {
        Row: {
          amount: number;
          conditions: string | null;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          event_id: string;
          id: string;
          inclusions: string;
          organizer_note: string | null;
          pending_cancellation_reason: string | null;
          provider_id: string;
          provider_name: string;
          quote_id: string;
          quote_revision: number;
          request_id: string;
          service_from: string;
          service_to: string;
          status: string;
          status_reason: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          conditions?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          event_id: string;
          id?: string;
          inclusions: string;
          organizer_note?: string | null;
          pending_cancellation_reason?: string | null;
          provider_id: string;
          provider_name: string;
          quote_id: string;
          quote_revision: number;
          request_id: string;
          service_from: string;
          service_to: string;
          status?: string;
          status_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          conditions?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          event_id?: string;
          id?: string;
          inclusions?: string;
          organizer_note?: string | null;
          pending_cancellation_reason?: string | null;
          provider_id?: string;
          provider_name?: string;
          quote_id?: string;
          quote_revision?: number;
          request_id?: string;
          service_from?: string;
          service_to?: string;
          status?: string;
          status_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "service_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      communication_deliveries: {
        Row: {
          approval_id: string;
          attempted_at: string;
          attendee_id: string | null;
          communication_id: string;
          email: string;
          error: string | null;
          event_id: string;
          id: string;
          is_simulated: boolean;
          provider_message_id: string | null;
          provider_response: Json | null;
          status: string;
          transport: string;
        };
        ComputedFields: never;
        Insert: {
          approval_id: string;
          attempted_at?: string;
          attendee_id?: string | null;
          communication_id: string;
          email: string;
          error?: string | null;
          event_id: string;
          id?: string;
          is_simulated: boolean;
          provider_message_id?: string | null;
          provider_response?: Json | null;
          status: string;
          transport: string;
        };
        Update: {
          approval_id?: string;
          attempted_at?: string;
          attendee_id?: string | null;
          communication_id?: string;
          email?: string;
          error?: string | null;
          event_id?: string;
          id?: string;
          is_simulated?: boolean;
          provider_message_id?: string | null;
          provider_response?: Json | null;
          status?: string;
          transport?: string;
        };
        Relationships: [
          {
            foreignKeyName: "communication_deliveries_attendee_id_fkey";
            columns: ["attendee_id"];
            isOneToOne: false;
            referencedRelation: "attendees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communication_deliveries_communication_id_fkey";
            columns: ["communication_id"];
            isOneToOne: false;
            referencedRelation: "communications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communication_deliveries_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      communications: {
        Row: {
          ai_run_id: string | null;
          attendee_id: string | null;
          audience: string;
          body: string;
          created_at: string;
          created_by: string | null;
          drafted_by: string;
          event_id: string;
          id: string;
          is_mock_draft: boolean;
          kind: string;
          recovery_plan_id: string | null;
          sent_at: string | null;
          status: string;
          subject: string;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          ai_run_id?: string | null;
          attendee_id?: string | null;
          audience: string;
          body: string;
          created_at?: string;
          created_by?: string | null;
          drafted_by?: string;
          event_id: string;
          id?: string;
          is_mock_draft?: boolean;
          kind: string;
          recovery_plan_id?: string | null;
          sent_at?: string | null;
          status?: string;
          subject: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          ai_run_id?: string | null;
          attendee_id?: string | null;
          audience?: string;
          body?: string;
          created_at?: string;
          created_by?: string | null;
          drafted_by?: string;
          event_id?: string;
          id?: string;
          is_mock_draft?: boolean;
          kind?: string;
          recovery_plan_id?: string | null;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "communications_ai_run_id_fkey";
            columns: ["ai_run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_attendee_id_fkey";
            columns: ["attendee_id"];
            isOneToOne: false;
            referencedRelation: "attendees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_recovery_plan_id_fkey";
            columns: ["recovery_plan_id"];
            isOneToOne: false;
            referencedRelation: "recovery_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      compliance_checks: {
        Row: {
          applicability: string;
          category: string;
          created_at: string;
          created_by: string | null;
          description: string;
          event_id: string;
          id: string;
          next_action: string | null;
          official_channel_id: string | null;
          origin: string;
          reason: string;
          reviewer_user_id: string | null;
          severity: string;
          status: string;
          status_changed_at: string | null;
          status_reason: string | null;
          status_set_by: string | null;
          title: string;
          topic_key: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          applicability?: string;
          category: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          event_id: string;
          id?: string;
          next_action?: string | null;
          official_channel_id?: string | null;
          origin: string;
          reason: string;
          reviewer_user_id?: string | null;
          severity?: string;
          status?: string;
          status_changed_at?: string | null;
          status_reason?: string | null;
          status_set_by?: string | null;
          title: string;
          topic_key: string;
          updated_at?: string;
        };
        Update: {
          applicability?: string;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          event_id?: string;
          id?: string;
          next_action?: string | null;
          official_channel_id?: string | null;
          origin?: string;
          reason?: string;
          reviewer_user_id?: string | null;
          severity?: string;
          status?: string;
          status_changed_at?: string | null;
          status_reason?: string | null;
          status_set_by?: string | null;
          title?: string;
          topic_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compliance_checks_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compliance_checks_official_channel_id_fkey";
            columns: ["official_channel_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      compliance_evidence: {
        Row: {
          check_id: string;
          event_id: string;
          id: string;
          is_simulated: boolean;
          kind: string;
          recorded_at: string;
          recorded_by: string | null;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          check_id: string;
          event_id: string;
          id?: string;
          is_simulated?: boolean;
          kind: string;
          recorded_at?: string;
          recorded_by?: string | null;
          value: string;
        };
        Update: {
          check_id?: string;
          event_id?: string;
          id?: string;
          is_simulated?: boolean;
          kind?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compliance_evidence_check_id_fkey";
            columns: ["check_id"];
            isOneToOne: false;
            referencedRelation: "compliance_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compliance_evidence_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      compliance_references: {
        Row: {
          added_by: string | null;
          check_id: string;
          created_at: string;
          event_id: string;
          id: string;
          relevance_note: string;
          source_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          check_id: string;
          created_at?: string;
          event_id: string;
          id?: string;
          relevance_note?: string;
          source_id: string;
        };
        Update: {
          added_by?: string | null;
          check_id?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          relevance_note?: string;
          source_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compliance_references_check_id_fkey";
            columns: ["check_id"];
            isOneToOne: false;
            referencedRelation: "compliance_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compliance_references_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compliance_references_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      event_members: {
        Row: {
          created_at: string;
          event_id: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          event_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_members_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      event_shortlists: {
        Row: {
          added_by: string | null;
          created_at: string;
          event_id: string;
          note: string | null;
          provider_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          event_id: string;
          note?: string | null;
          provider_id: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          event_id?: string;
          note?: string | null;
          provider_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_shortlists_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_shortlists_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          budget_amount: number | null;
          capacity: number;
          city: string | null;
          country: string;
          created_at: string;
          currency: string;
          ends_at: string;
          event_type: string;
          id: string;
          location_text: string | null;
          name: string;
          owner_id: string;
          published_slug: string | null;
          registration_open: boolean;
          requires_application: boolean;
          starts_at: string;
          status: string;
          timezone: string;
          updated_at: string;
          venue_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          budget_amount?: number | null;
          capacity: number;
          city?: string | null;
          country?: string;
          created_at?: string;
          currency?: string;
          ends_at: string;
          event_type?: string;
          id?: string;
          location_text?: string | null;
          name: string;
          owner_id: string;
          published_slug?: string | null;
          registration_open?: boolean;
          requires_application?: boolean;
          starts_at: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
          venue_type?: string | null;
        };
        Update: {
          budget_amount?: number | null;
          capacity?: number;
          city?: string | null;
          country?: string;
          created_at?: string;
          currency?: string;
          ends_at?: string;
          event_type?: string;
          id?: string;
          location_text?: string | null;
          name?: string;
          owner_id?: string;
          published_slug?: string | null;
          registration_open?: boolean;
          requires_application?: boolean;
          starts_at?: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
          venue_type?: string | null;
        };
        Relationships: [];
      };
      incidents: {
        Row: {
          booking_id: string;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          created_by: string | null;
          event_id: string;
          id: string;
          idempotency_key: string;
          impact: NonNullable<Json>;
          is_simulated: boolean;
          kind: string;
          note: string | null;
          resolution_note: string | null;
          simulated_at: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_id: string;
          id?: string;
          idempotency_key: string;
          impact: NonNullable<Json>;
          is_simulated?: boolean;
          kind?: string;
          note?: string | null;
          resolution_note?: string | null;
          simulated_at?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          booking_id?: string;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_id?: string;
          id?: string;
          idempotency_key?: string;
          impact?: NonNullable<Json>;
          is_simulated?: boolean;
          kind?: string;
          note?: string | null;
          resolution_note?: string | null;
          simulated_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incidents_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_answers: {
        Row: {
          answer: NonNullable<Json>;
          answered_by: string | null;
          created_at: string;
          event_id: string;
          id: string;
          playbook_id: string;
          playbook_version: number;
          question_key: string;
          source: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          answer: NonNullable<Json>;
          answered_by?: string | null;
          created_at?: string;
          event_id: string;
          id?: string;
          playbook_id: string;
          playbook_version: number;
          question_key: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          answer?: NonNullable<Json>;
          answered_by?: string | null;
          created_at?: string;
          event_id?: string;
          id?: string;
          playbook_id?: string;
          playbook_version?: number;
          question_key?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interview_answers_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_sources: {
        Row: {
          authority: string;
          created_at: string;
          id: string;
          is_curated: boolean;
          jurisdiction: string;
          key: string;
          last_verified_at: string | null;
          retrieval_note: string;
          retrieval_status: string;
          retrieved_at: string | null;
          scope: string;
          source_type: string;
          summary: string;
          summary_kind: string;
          title: string;
          updated_at: string;
          url: string;
          verification_note: string | null;
          verified_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          authority: string;
          created_at?: string;
          id?: string;
          is_curated?: boolean;
          jurisdiction: string;
          key: string;
          last_verified_at?: string | null;
          retrieval_note?: string;
          retrieval_status?: string;
          retrieved_at?: string | null;
          scope?: string;
          source_type: string;
          summary?: string;
          summary_kind?: string;
          title: string;
          updated_at?: string;
          url: string;
          verification_note?: string | null;
          verified_by?: string | null;
        };
        Update: {
          authority?: string;
          created_at?: string;
          id?: string;
          is_curated?: boolean;
          jurisdiction?: string;
          key?: string;
          last_verified_at?: string | null;
          retrieval_note?: string;
          retrieval_status?: string;
          retrieved_at?: string | null;
          scope?: string;
          source_type?: string;
          summary?: string;
          summary_kind?: string;
          title?: string;
          updated_at?: string;
          url?: string;
          verification_note?: string | null;
          verified_by?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string;
          channel: string;
          created_at: string;
          dedupe_key: string | null;
          delivery_status: string;
          event_id: string | null;
          id: string;
          kind: string;
          link_path: string | null;
          read_at: string | null;
          title: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          channel?: string;
          created_at?: string;
          dedupe_key?: string | null;
          delivery_status?: string;
          event_id?: string | null;
          id?: string;
          kind: string;
          link_path?: string | null;
          read_at?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string;
          channel?: string;
          created_at?: string;
          dedupe_key?: string | null;
          delivery_status?: string;
          event_id?: string | null;
          id?: string;
          kind?: string;
          link_path?: string | null;
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      official_submissions: {
        Row: {
          authority: string;
          channel_source_id: string | null;
          check_id: string;
          event_id: string;
          id: string;
          is_simulated: boolean;
          reference: string;
          responded_at: string | null;
          response_summary: string | null;
          status: string;
          submitted_at: string;
          submitted_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          authority: string;
          channel_source_id?: string | null;
          check_id: string;
          event_id: string;
          id?: string;
          is_simulated?: boolean;
          reference: string;
          responded_at?: string | null;
          response_summary?: string | null;
          status?: string;
          submitted_at?: string;
          submitted_by?: string | null;
        };
        Update: {
          authority?: string;
          channel_source_id?: string | null;
          check_id?: string;
          event_id?: string;
          id?: string;
          is_simulated?: boolean;
          reference?: string;
          responded_at?: string | null;
          response_summary?: string | null;
          status?: string;
          submitted_at?: string;
          submitted_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "official_submissions_channel_source_id_fkey";
            columns: ["channel_source_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "official_submissions_check_id_fkey";
            columns: ["check_id"];
            isOneToOne: false;
            referencedRelation: "compliance_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "official_submissions_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          granted_by: string | null;
          note: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          note?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          note?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      platform_settings: {
        Row: {
          enabled: boolean;
          key: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          enabled: boolean;
          key: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          enabled?: boolean;
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          account_status: string;
          created_at: string;
          display_name: string | null;
          locale: string;
          onboarded_at: string | null;
          phone: string | null;
          status_reason: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_status?: string;
          created_at?: string;
          display_name?: string | null;
          locale?: string;
          onboarded_at?: string | null;
          phone?: string | null;
          status_reason?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_status?: string;
          created_at?: string;
          display_name?: string | null;
          locale?: string;
          onboarded_at?: string | null;
          phone?: string | null;
          status_reason?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      provider_documents: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_on: string | null;
          id: string;
          issued_by: string | null;
          kind: string;
          provider_id: string;
          reference_number: string | null;
          review_note: string | null;
          review_status: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_on?: string | null;
          id?: string;
          issued_by?: string | null;
          kind: string;
          provider_id: string;
          reference_number?: string | null;
          review_note?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          title: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_on?: string | null;
          id?: string;
          issued_by?: string | null;
          kind?: string;
          provider_id?: string;
          reference_number?: string | null;
          review_note?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_documents_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_members: {
        Row: {
          created_at: string;
          provider_id: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          provider_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          provider_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_members_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_private: {
        Row: {
          contact_email: string | null;
          contact_phone: string | null;
          legal_name: string | null;
          provider_id: string;
          trade_license_number: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          contact_email?: string | null;
          contact_phone?: string | null;
          legal_name?: string | null;
          provider_id: string;
          trade_license_number?: string | null;
          updated_at?: string;
        };
        Update: {
          contact_email?: string | null;
          contact_phone?: string | null;
          legal_name?: string | null;
          provider_id?: string;
          trade_license_number?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_private_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_services: {
        Row: {
          category: string;
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          inclusions: string[];
          is_active: boolean;
          max_quantity: number | null;
          min_quantity: number | null;
          price_from: number | null;
          price_to: number | null;
          pricing_model: string;
          provider_id: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          inclusions?: string[];
          is_active?: boolean;
          max_quantity?: number | null;
          min_quantity?: number | null;
          price_from?: number | null;
          price_to?: number | null;
          pricing_model?: string;
          provider_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          inclusions?: string[];
          is_active?: boolean;
          max_quantity?: number | null;
          min_quantity?: number | null;
          price_from?: number | null;
          price_to?: number | null;
          pricing_model?: string;
          provider_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_services_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      providers: {
        Row: {
          availability_note: string | null;
          capabilities: string[];
          category: string;
          city: string | null;
          country: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string | null;
          id: string;
          is_demo: boolean;
          is_listed: boolean;
          kind: string;
          max_capacity: number | null;
          min_capacity: number | null;
          moderation_reason: string | null;
          moderation_status: string;
          name: string;
          price_max: number | null;
          price_min: number | null;
          pricing_model: string;
          service_area: string[];
          submitted_at: string | null;
          updated_at: string;
          verification_note: string | null;
          verification_status: string;
          verified_at: string | null;
          verified_by: string | null;
          website: string | null;
        };
        ComputedFields: never;
        Insert: {
          availability_note?: string | null;
          capabilities?: string[];
          category: string;
          city?: string | null;
          country?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          id?: string;
          is_demo?: boolean;
          is_listed?: boolean;
          kind: string;
          max_capacity?: number | null;
          min_capacity?: number | null;
          moderation_reason?: string | null;
          moderation_status?: string;
          name: string;
          price_max?: number | null;
          price_min?: number | null;
          pricing_model?: string;
          service_area?: string[];
          submitted_at?: string | null;
          updated_at?: string;
          verification_note?: string | null;
          verification_status?: string;
          verified_at?: string | null;
          verified_by?: string | null;
          website?: string | null;
        };
        Update: {
          availability_note?: string | null;
          capabilities?: string[];
          category?: string;
          city?: string | null;
          country?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          id?: string;
          is_demo?: boolean;
          is_listed?: boolean;
          kind?: string;
          max_capacity?: number | null;
          min_capacity?: number | null;
          moderation_reason?: string | null;
          moderation_status?: string;
          name?: string;
          price_max?: number | null;
          price_min?: number | null;
          pricing_model?: string;
          service_area?: string[];
          submitted_at?: string | null;
          updated_at?: string;
          verification_note?: string | null;
          verification_status?: string;
          verified_at?: string | null;
          verified_by?: string | null;
          website?: string | null;
        };
        Relationships: [];
      };
      quotes: {
        Row: {
          amount: number;
          conditions: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          decline_reason: string | null;
          exclusions: string | null;
          id: string;
          inclusions: string;
          provider_id: string;
          request_id: string;
          revision: number;
          status: string;
          submitted_at: string | null;
          updated_at: string;
          valid_until: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          conditions?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          decline_reason?: string | null;
          exclusions?: string | null;
          id?: string;
          inclusions: string;
          provider_id: string;
          request_id: string;
          revision?: number;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string;
          valid_until: string;
        };
        Update: {
          amount?: number;
          conditions?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          decline_reason?: string | null;
          exclusions?: string | null;
          id?: string;
          inclusions?: string;
          provider_id?: string;
          request_id?: string;
          revision?: number;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string;
          valid_until?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_request_id_provider_id_fkey";
            columns: ["request_id", "provider_id"];
            isOneToOne: true;
            referencedRelation: "service_request_invites";
            referencedColumns: ["request_id", "provider_id"];
          },
        ];
      };
      recovery_changes: {
        Row: {
          applied_at: string | null;
          entity_id: string | null;
          entity_type: string | null;
          event_id: string;
          id: string;
          incident_id: string;
          kind: string;
          payload: NonNullable<Json>;
          plan_id: string;
          selected: boolean;
          seq: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          applied_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          event_id: string;
          id?: string;
          incident_id: string;
          kind: string;
          payload: NonNullable<Json>;
          plan_id: string;
          selected?: boolean;
          seq: number;
          status?: string;
        };
        Update: {
          applied_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          event_id?: string;
          id?: string;
          incident_id?: string;
          kind?: string;
          payload?: NonNullable<Json>;
          plan_id?: string;
          selected?: boolean;
          seq?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recovery_changes_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_changes_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_changes_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "recovery_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      recovery_flags: {
        Row: {
          action: string;
          created_at: string;
          created_by: string | null;
          entity_id: string;
          entity_type: string;
          event_id: string;
          id: string;
          incident_id: string;
          reason: string;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          created_at?: string;
          created_by?: string | null;
          entity_id: string;
          entity_type: string;
          event_id: string;
          id?: string;
          incident_id: string;
          reason: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          created_by?: string | null;
          entity_id?: string;
          entity_type?: string;
          event_id?: string;
          id?: string;
          incident_id?: string;
          reason?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recovery_flags_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_flags_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      recovery_inquiries: {
        Row: {
          body: string;
          booking_id: string | null;
          created_at: string;
          event_id: string;
          id: string;
          incident_id: string;
          plan_id: string;
          provider_id: string;
          purpose: string;
          sent_at: string | null;
          status: string;
          subject: string;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          booking_id?: string | null;
          created_at?: string;
          event_id: string;
          id?: string;
          incident_id: string;
          plan_id: string;
          provider_id: string;
          purpose: string;
          sent_at?: string | null;
          status?: string;
          subject: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          body?: string;
          booking_id?: string | null;
          created_at?: string;
          event_id?: string;
          id?: string;
          incident_id?: string;
          plan_id?: string;
          provider_id?: string;
          purpose?: string;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recovery_inquiries_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_inquiries_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_inquiries_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_inquiries_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "recovery_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_inquiries_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      recovery_plans: {
        Row: {
          ai_run_id: string | null;
          applied_at: string | null;
          applied_by: string | null;
          created_at: string;
          created_by: string | null;
          event_id: string;
          id: string;
          incident_id: string;
          is_mock: boolean;
          proposal: NonNullable<Json>;
          proposal_hash: string;
          status: string;
          status_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          ai_run_id?: string | null;
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_id: string;
          id?: string;
          incident_id: string;
          is_mock?: boolean;
          proposal: NonNullable<Json>;
          proposal_hash: string;
          status?: string;
          status_reason?: string | null;
        };
        Update: {
          ai_run_id?: string | null;
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_id?: string;
          id?: string;
          incident_id?: string;
          is_mock?: boolean;
          proposal?: NonNullable<Json>;
          proposal_hash?: string;
          status?: string;
          status_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recovery_plans_ai_run_id_fkey";
            columns: ["ai_run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_plans_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recovery_plans_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      review_reports: {
        Row: {
          created_at: string;
          details: string;
          id: string;
          kind: string;
          reason: string;
          reporter_user_id: string | null;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          review_id: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          details: string;
          id?: string;
          kind: string;
          reason: string;
          reporter_user_id?: string | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          review_id: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          details?: string;
          id?: string;
          kind?: string;
          reason?: string;
          reporter_user_id?: string | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          review_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_reports_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      review_responses: {
        Row: {
          author_user_id: string | null;
          body: string;
          created_at: string;
          review_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_user_id?: string | null;
          body: string;
          created_at?: string;
          review_id: string;
        };
        Update: {
          author_user_id?: string | null;
          body?: string;
          created_at?: string;
          review_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_responses_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: true;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          body: string;
          booking_id: string;
          created_at: string;
          direction: string;
          event_id: string;
          id: string;
          moderated_at: string | null;
          moderated_by: string | null;
          moderation_note: string | null;
          provider_id: string;
          rating: number;
          reviewer_user_id: string | null;
          status: string;
          target_user_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          booking_id: string;
          created_at?: string;
          direction: string;
          event_id: string;
          id?: string;
          moderated_at?: string | null;
          moderated_by?: string | null;
          moderation_note?: string | null;
          provider_id: string;
          rating: number;
          reviewer_user_id?: string | null;
          status?: string;
          target_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          body?: string;
          booking_id?: string;
          created_at?: string;
          direction?: string;
          event_id?: string;
          id?: string;
          moderated_at?: string | null;
          moderated_by?: string | null;
          moderation_note?: string | null;
          provider_id?: string;
          rating?: number;
          reviewer_user_id?: string | null;
          status?: string;
          target_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      service_request_invites: {
        Row: {
          decline_reason: string | null;
          invited_at: string;
          provider_id: string;
          request_id: string;
          responded_at: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          decline_reason?: string | null;
          invited_at?: string;
          provider_id: string;
          request_id: string;
          responded_at?: string | null;
          status?: string;
        };
        Update: {
          decline_reason?: string | null;
          invited_at?: string;
          provider_id?: string;
          request_id?: string;
          responded_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_request_invites_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_request_invites_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "service_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      service_request_messages: {
        Row: {
          author_id: string | null;
          author_side: string;
          body: string;
          created_at: string;
          id: string;
          provider_id: string;
          request_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          author_side: string;
          body: string;
          created_at?: string;
          id?: string;
          provider_id: string;
          request_id: string;
        };
        Update: {
          author_id?: string | null;
          author_side?: string;
          body?: string;
          created_at?: string;
          id?: string;
          provider_id?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_request_messages_request_id_provider_id_fkey";
            columns: ["request_id", "provider_id"];
            isOneToOne: false;
            referencedRelation: "service_request_invites";
            referencedColumns: ["request_id", "provider_id"];
          },
        ];
      };
      service_requests: {
        Row: {
          budget_max: number | null;
          category: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          event_city: string | null;
          event_id: string;
          event_name: string;
          expected_attendance: number;
          id: string;
          needed_from: string;
          needed_to: string;
          requirements: string;
          respond_by: string | null;
          status: string;
          timezone: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          budget_max?: number | null;
          category: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          event_city?: string | null;
          event_id: string;
          event_name: string;
          expected_attendance: number;
          id?: string;
          needed_from: string;
          needed_to: string;
          requirements: string;
          respond_by?: string | null;
          status?: string;
          timezone: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          budget_max?: number | null;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          event_city?: string | null;
          event_id?: string;
          event_name?: string;
          expected_attendance?: number;
          id?: string;
          needed_from?: string;
          needed_to?: string;
          requirements?: string;
          respond_by?: string | null;
          status?: string;
          timezone?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_requests_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      task_dependencies: {
        Row: {
          created_at: string;
          created_by: string | null;
          depends_on_task_id: string;
          event_id: string;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          depends_on_task_id: string;
          event_id: string;
          task_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          depends_on_task_id?: string;
          event_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey";
            columns: ["depends_on_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_dependencies_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          category: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string;
          due_date: string | null;
          event_id: string;
          id: string;
          origin: string;
          owner_label: string | null;
          owner_user_id: string | null;
          plan_item_key: string | null;
          priority: string;
          status: string;
          suggestion_id: string | null;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_date?: string | null;
          event_id: string;
          id?: string;
          origin?: string;
          owner_label?: string | null;
          owner_user_id?: string | null;
          plan_item_key?: string | null;
          priority?: string;
          status?: string;
          suggestion_id?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_date?: string | null;
          event_id?: string;
          id?: string;
          origin?: string;
          owner_label?: string | null;
          owner_user_id?: string | null;
          plan_item_key?: string | null;
          priority?: string;
          status?: string;
          suggestion_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_suggestion_id_fkey";
            columns: ["suggestion_id"];
            isOneToOne: false;
            referencedRelation: "ai_suggestions";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      venue_profiles: {
        Row: {
          access_conditions: string | null;
          accessibility: string[];
          address_text: string | null;
          area: string | null;
          provider_id: string;
          seated_capacity: number | null;
          setting: string;
          standing_capacity: number | null;
          suitability: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          access_conditions?: string | null;
          accessibility?: string[];
          address_text?: string | null;
          area?: string | null;
          provider_id: string;
          seated_capacity?: number | null;
          setting?: string;
          standing_capacity?: number | null;
          suitability?: string[];
          updated_at?: string;
        };
        Update: {
          access_conditions?: string | null;
          accessibility?: string[];
          address_text?: string | null;
          area?: string | null;
          provider_id?: string;
          seated_capacity?: number | null;
          setting?: string;
          standing_capacity?: number | null;
          suitability?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "venue_profiles_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_ai_plan: { Args: { p_plan_id: string; p_suggestion_ids?: string[] }; Returns: number };
      add_attendee: {
        Args: {
          p_email: string;
          p_event_id: string;
          p_full_name: string;
          p_phone: string;
          p_registered: boolean;
        };
        Returns: string;
      };
      add_compliance_evidence: {
        Args: { p_check_id: string; p_kind: string; p_value: string };
        Returns: string;
      };
      add_compliance_reference: {
        Args: { p_check_id: string; p_note: string; p_source_id: string };
        Returns: undefined;
      };
      ai_assert_event_manager: { Args: { p_event_id: string }; Returns: undefined };
      ai_assert_usable_run: {
        Args: { p_event_id: string; p_pipeline: string; p_run_id: string };
        Returns: undefined;
      };
      approval_assert_manager: { Args: { p_event_id: string }; Returns: undefined };
      approval_payload: { Args: { p_action_type: string; p_target_id: string }; Returns: Json };
      approval_payload_unchanged: {
        Args: {
          p_a: Omit<
            Database["public"]["Tables"]["approvals"]["Row"],
            Database["public"]["Tables"]["approvals"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      approval_sync_target: {
        Args: { p_action_type: string; p_status: string; p_target_id: string };
        Returns: undefined;
      };
      approval_target_event: {
        Args: { p_action_type: string; p_target_id: string };
        Returns: string;
      };
      assign_compliance_reviewer: {
        Args: { p_check_id: string; p_reviewer: string };
        Returns: undefined;
      };
      attendee_assert_manager: { Args: { p_event_id: string }; Returns: undefined };
      booking_apply: {
        Args: { p_actor: string; p_booking_id: string; p_reason: string; p_to: string };
        Returns: undefined;
      };
      booking_assert_manager: {
        Args: { p_booking_id: string };
        Returns: {
          amount: number;
          conditions: string | null;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          event_id: string;
          id: string;
          inclusions: string;
          organizer_note: string | null;
          pending_cancellation_reason: string | null;
          provider_id: string;
          provider_name: string;
          quote_id: string;
          quote_revision: number;
          request_id: string;
          service_from: string;
          service_to: string;
          status: string;
          status_reason: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "bookings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      booking_transition_allowed: {
        Args: { p_actor: string; p_from: string; p_to: string };
        Returns: boolean;
      };
      cancel_communication: { Args: { p_id: string }; Returns: undefined };
      claim_approval: { Args: { p_approval_id: string }; Returns: Json };
      close_incident: {
        Args: { p_incident_id: string; p_note: string; p_outcome: string };
        Returns: undefined;
      };
      communication_recipients: { Args: { p_communication_id: string }; Returns: Json };
      complete_onboarding: {
        Args: { p_display_name: string; p_locale: string; p_phone: string; p_roles: string[] };
        Returns: undefined;
      };
      compliance_assert_manager: { Args: { p_event_id: string }; Returns: undefined };
      compliance_transition_allowed: { Args: { p_from: string; p_to: string }; Returns: boolean };
      create_compliance_check: {
        Args: {
          p_category: string;
          p_description: string;
          p_event_id: string;
          p_reason: string;
          p_title: string;
          p_topic_key: string;
        };
        Returns: string;
      };
      create_provider: {
        Args: {
          p_category: string;
          p_city?: string;
          p_contact_email?: string;
          p_contact_phone?: string;
          p_currency?: string;
          p_description?: string;
          p_kind: string;
          p_max_capacity?: number;
          p_min_capacity?: number;
          p_name: string;
          p_price_max?: number;
          p_price_min?: number;
          p_service_area?: string[];
        };
        Returns: string;
      };
      create_review: {
        Args: { p_body: string; p_booking_id: string; p_direction: string; p_rating: number };
        Returns: string;
      };
      create_service_request: {
        Args: {
          p_budget_max: number;
          p_category: string;
          p_currency: string;
          p_event_id: string;
          p_expected_attendance: number;
          p_needed_from: string;
          p_needed_to: string;
          p_provider_ids: string[];
          p_requirements: string;
          p_respond_by: string;
          p_title: string;
        };
        Returns: string;
      };
      decide_approval: {
        Args: { p_approval_id: string; p_approve: boolean; p_note: string };
        Returns: string;
      };
      decline_quote: { Args: { p_quote_id: string; p_reason: string }; Returns: undefined };
      decline_service_request: {
        Args: { p_provider_id: string; p_reason: string; p_request_id: string };
        Returns: undefined;
      };
      discard_recovery_inquiry: { Args: { p_id: string }; Returns: undefined };
      dismiss_ai_suggestion: { Args: { p_suggestion_id: string }; Returns: undefined };
      event_attendance_summary: {
        Args: { p_event_id: string };
        Returns: {
          capacity: number;
          checked_in: number;
          pending: number;
          taken: number;
          waitlisted: number;
        }[];
      };
      event_member_directory: {
        Args: { p_event_id: string };
        Returns: {
          display_name: string;
          role: string;
          user_id: string;
        }[];
      };
      event_places_taken: { Args: { p_event_id: string }; Returns: number };
      event_status_transition_allowed: { Args: { p_from: string; p_to: string }; Returns: boolean };
      event_timeline: {
        Args: { p_event_id: string; p_limit?: number };
        Returns: {
          action: string;
          actor_kind: string;
          actor_name: string;
          at: string;
          details: Json;
          entity_id: string;
          entity_type: string;
        }[];
      };
      event_workspace_open: { Args: { p_event_id: string }; Returns: boolean };
      execute_booking_approval: { Args: { p_approval_id: string }; Returns: string };
      execute_inquiry_approval: { Args: { p_approval_id: string }; Returns: string };
      execute_recovery_approval: { Args: { p_approval_id: string }; Returns: string };
      finish_ai_run: {
        Args: {
          p_attempts: number;
          p_error_code: string;
          p_input_tokens: number;
          p_latency_ms: number;
          p_model: string;
          p_output_tokens: number;
          p_run_id: string;
          p_status: string;
        };
        Returns: undefined;
      };
      finish_communication: {
        Args: { p_approval_id: string; p_results: Json; p_transport: string };
        Returns: string;
      };
      has_account_role: { Args: { p_role: string }; Returns: boolean };
      invite_providers: {
        Args: { p_provider_ids: string[]; p_request_id: string };
        Returns: undefined;
      };
      is_active_account: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_event_member: { Args: { p_event_id: string; p_roles?: string[] }; Returns: boolean };
      is_invited_provider_member: {
        Args: { p_provider_id?: string; p_request_id: string };
        Returns: boolean;
      };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_provider_member: { Args: { p_provider_id: string; p_roles?: string[] }; Returns: boolean };
      is_request_manager: { Args: { p_request_id: string }; Returns: boolean };
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number };
      moderate_review: {
        Args: { p_note: string; p_review_id: string; p_status: string };
        Returns: undefined;
      };
      my_reviews: {
        Args: Record<PropertyKey, never>;
        Returns: {
          body: string;
          booking_id: string;
          created_at: string;
          direction: string;
          event_id: string;
          event_name: string;
          id: string;
          moderation_note: string;
          my_report_kinds: string[];
          provider_id: string;
          provider_name: string;
          rating: number;
          response_at: string;
          response_body: string;
          side: string;
          status: string;
        }[];
      };
      notify_event_managers: {
        Args: {
          p_body: string;
          p_dedupe: string;
          p_event: string;
          p_except?: string;
          p_kind: string;
          p_link: string;
          p_title: string;
        };
        Returns: number;
      };
      notify_provider_members: {
        Args: {
          p_body: string;
          p_dedupe: string;
          p_event: string;
          p_kind: string;
          p_link: string;
          p_provider: string;
          p_title: string;
        };
        Returns: number;
      };
      notify_user: {
        Args: {
          p_body: string;
          p_dedupe: string;
          p_event: string;
          p_kind: string;
          p_link: string;
          p_title: string;
          p_user: string;
        };
        Returns: number;
      };
      organizer_booking_action: {
        Args: { p_booking_id: string; p_reason: string; p_to: string };
        Returns: undefined;
      };
      organizer_rating_summary: {
        Args: { p_user_id: string };
        Returns: {
          average: number;
          review_count: number;
        }[];
      };
      organizer_reviews: {
        Args: { p_user_id: string };
        Returns: {
          body: string;
          created_at: string;
          id: string;
          provider_name: string;
          rating: number;
          verified: boolean;
        }[];
      };
      participation_transition_allowed: {
        Args: { p_from: string; p_to: string };
        Returns: boolean;
      };
      payload_hash: { Args: { p: Json }; Returns: string };
      post_request_message: {
        Args: { p_body: string; p_provider_id: string; p_request_id: string; p_side: string };
        Returns: string;
      };
      propose_booking: { Args: { p_note: string; p_quote_id: string }; Returns: string };
      provider_booking_action: {
        Args: { p_booking_id: string; p_reason: string; p_to: string };
        Returns: undefined;
      };
      provider_can_receive_requests: { Args: { p_provider_id: string }; Returns: boolean };
      provider_invited_by_me: { Args: { p_provider_id: string }; Returns: boolean };
      provider_is_public: { Args: { p_provider_id: string }; Returns: boolean };
      provider_moderation_transition_allowed: {
        Args: { p_from: string; p_to: string };
        Returns: boolean;
      };
      provider_rating_summary: {
        Args: { p_provider_id: string };
        Returns: {
          average: number;
          review_count: number;
          stars_1: number;
          stars_2: number;
          stars_3: number;
          stars_4: number;
          stars_5: number;
        }[];
      };
      provider_reviews: {
        Args: { p_provider_id: string };
        Returns: {
          body: string;
          created_at: string;
          id: string;
          rating: number;
          response_at: string;
          response_body: string;
          reviewer_name: string;
          verified: boolean;
        }[];
      };
      provider_verification_admin_transition_allowed: {
        Args: { p_from: string; p_to: string };
        Returns: boolean;
      };
      public_event_by_slug: {
        Args: { p_slug: string };
        Returns: {
          city: string;
          ends_at: string;
          name: string;
          places_left: number;
          requires_application: boolean;
          starts_at: string;
          timezone: string;
          venue_type: string;
        }[];
      };
      quote_transition_allowed: {
        Args: { p_actor: string; p_from: string; p_to: string };
        Returns: boolean;
      };
      record_simulated_response: {
        Args: { p_submission_id: string; p_summary: string };
        Returns: undefined;
      };
      recovery_assert_incident: {
        Args: { p_incident_id: string };
        Returns: {
          booking_id: string;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          created_by: string | null;
          event_id: string;
          id: string;
          idempotency_key: string;
          impact: NonNullable<Json>;
          is_simulated: boolean;
          kind: string;
          note: string | null;
          resolution_note: string | null;
          simulated_at: string;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "incidents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      recovery_impact: { Args: { p_booking_id: string; p_event_id: string }; Returns: Json };
      recovery_withdraw_plan: { Args: { p_plan_id: string; p_reason: string }; Returns: undefined };
      refresh_event_notifications: {
        Args: { p_event_id: string; p_missing?: Json };
        Returns: number;
      };
      register_attendee: {
        Args: {
          p_application_note: string;
          p_consent: boolean;
          p_email: string;
          p_full_name: string;
          p_phone: string;
          p_slug: string;
        };
        Returns: string;
      };
      reject_recovery_plan: { Args: { p_plan_id: string; p_reason: string }; Returns: undefined };
      report_review: {
        Args: { p_details: string; p_kind: string; p_reason: string; p_review_id: string };
        Returns: string;
      };
      request_approval: { Args: { p_action_type: string; p_target_id: string }; Returns: string };
      request_booking_approval: { Args: { p_booking_id: string }; Returns: string };
      request_booking_cancellation: {
        Args: { p_booking_id: string; p_reason: string };
        Returns: string;
      };
      request_event_id: { Args: { p_request_id: string }; Returns: string };
      resolve_booking_dispute: {
        Args: { p_booking_id: string; p_reason: string; p_to: string };
        Returns: undefined;
      };
      resolve_recovery_flag: { Args: { p_flag_id: string; p_note: string }; Returns: undefined };
      resolve_review_report: {
        Args: { p_hide: boolean; p_note: string; p_report_id: string; p_resolution: string };
        Returns: undefined;
      };
      respond_to_review: { Args: { p_body: string; p_review_id: string }; Returns: undefined };
      review_candidates: {
        Args: Record<PropertyKey, never>;
        Returns: {
          booking_id: string;
          eligible: boolean;
          event_id: string;
          event_name: string;
          provider_id: string;
          provider_name: string;
          reason: string;
          review_id: string;
          service_to: string;
          side: string;
        }[];
      };
      review_check: { Args: { p_booking_id: string; p_direction: string }; Returns: string };
      review_organizer_visible: { Args: { p_user_id: string }; Returns: boolean };
      review_provider_document: {
        Args: { p_document_id: string; p_note: string; p_status: string };
        Returns: undefined;
      };
      review_provider_visible: { Args: { p_provider_id: string }; Returns: boolean };
      review_side: { Args: { p_review_id: string }; Returns: string };
      review_transition_allowed: { Args: { p_from: string; p_to: string }; Returns: boolean };
      revise_ai_task: {
        Args: { p_payload: Json; p_run_id: string; p_suggestion_id: string };
        Returns: string;
      };
      save_ai_followups: {
        Args: { p_event_id: string; p_questions: Json; p_run_id: string };
        Returns: number;
      };
      save_ai_plan: {
        Args: {
          p_assumptions: Json;
          p_event_id: string;
          p_input_hash: string;
          p_playbook_id: string;
          p_playbook_version: number;
          p_run_id: string;
          p_source: string;
          p_tasks: Json;
        };
        Returns: string;
      };
      save_communication: {
        Args: {
          p_ai_run_id: string;
          p_attendee_id: string;
          p_audience: string;
          p_body: string;
          p_event_id: string;
          p_id: string;
          p_kind: string;
          p_subject: string;
        };
        Returns: string;
      };
      save_interview_answers: {
        Args: {
          p_answers: Json;
          p_event_id: string;
          p_playbook_id: string;
          p_playbook_version: number;
          p_remove_keys?: string[];
        };
        Returns: number;
      };
      save_quote: {
        Args: {
          p_amount: number;
          p_conditions: string;
          p_currency: string;
          p_exclusions: string;
          p_inclusions: string;
          p_provider_id: string;
          p_request_id: string;
          p_submit: boolean;
          p_valid_until: string;
        };
        Returns: string;
      };
      save_recovery_plan: {
        Args: {
          p_ai_run_id: string;
          p_attendee_draft: Json;
          p_changes: Json;
          p_incident_id: string;
          p_inquiries: Json;
          p_proposal: Json;
        };
        Returns: string;
      };
      search_providers: {
        Args: {
          p_attendance?: number;
          p_budget?: number;
          p_category?: string;
          p_city?: string;
          p_limit?: number;
          p_offset?: number;
          p_query?: string;
        };
        Returns: {
          availability_note: string | null;
          capabilities: string[];
          category: string;
          city: string | null;
          country: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string | null;
          id: string;
          is_demo: boolean;
          is_listed: boolean;
          kind: string;
          max_capacity: number | null;
          min_capacity: number | null;
          moderation_reason: string | null;
          moderation_status: string;
          name: string;
          price_max: number | null;
          price_min: number | null;
          pricing_model: string;
          service_area: string[];
          submitted_at: string | null;
          updated_at: string;
          verification_note: string | null;
          verification_status: string;
          verified_at: string | null;
          verified_by: string | null;
          website: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "providers";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      service_request_transition_allowed: {
        Args: { p_from: string; p_to: string };
        Returns: boolean;
      };
      set_account_status: {
        Args: { p_reason: string; p_status: string; p_user_id: string };
        Returns: undefined;
      };
      set_attendee_participation: {
        Args: { p_attendee_id: string; p_reason: string; p_status: string };
        Returns: string;
      };
      set_attendee_review: {
        Args: { p_attendee_id: string; p_reason: string; p_status: string };
        Returns: undefined;
      };
      set_compliance_status: {
        Args: { p_check_id: string; p_reason: string; p_status: string };
        Returns: undefined;
      };
      set_platform_setting: { Args: { p_enabled: boolean; p_key: string }; Returns: undefined };
      set_provider_moderation: {
        Args: { p_provider_id: string; p_reason: string; p_status: string };
        Returns: undefined;
      };
      set_provider_verification: {
        Args: { p_note: string; p_provider_id: string; p_status: string };
        Returns: undefined;
      };
      set_recovery_selection: {
        Args: { p_change_ids: string[]; p_plan_id: string };
        Returns: undefined;
      };
      set_service_request_status: {
        Args: { p_request_id: string; p_status: string };
        Returns: undefined;
      };
      set_source_verification: {
        Args: { p_note: string; p_source_id: string; p_verified: boolean };
        Returns: undefined;
      };
      simulatable_venue_bookings: {
        Args: { p_event_id: string };
        Returns: {
          amount: number;
          booking_id: string;
          currency: string;
          provider_name: string;
          service_from: string;
          service_to: string;
          status: string;
        }[];
      };
      simulate_official_submission: { Args: { p_check_id: string }; Returns: string };
      simulate_venue_cancellation: {
        Args: {
          p_booking_id: string;
          p_event_id: string;
          p_idempotency_key: string;
          p_note: string;
        };
        Returns: Json;
      };
      start_ai_run: {
        Args: {
          p_event_id: string;
          p_input_hash: string;
          p_is_mock: boolean;
          p_model: string;
          p_pipeline: string;
          p_provider: string;
        };
        Returns: string;
      };
      submit_provider_for_verification: { Args: { p_provider_id: string }; Returns: undefined };
      sync_compliance_checks: { Args: { p_event_id: string; p_items: Json }; Returns: number };
      task_is_blocked: { Args: { p_task_id: string }; Returns: boolean };
      task_status_transition_allowed: { Args: { p_from: string; p_to: string }; Returns: boolean };
      update_compliance_check: {
        Args: { p_applicability: string; p_check_id: string; p_next_action: string };
        Returns: undefined;
      };
      update_recovery_inquiry: {
        Args: { p_body: string; p_id: string; p_subject: string };
        Returns: undefined;
      };
      withdraw_attendee: { Args: { p_attendee_id: string; p_reason: string }; Returns: undefined };
      withdraw_quote: { Args: { p_quote_id: string }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
