export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      blocked_domains: {
        Row: {
          added_at: string;
          domain: string;
          source: string;
        };
        Insert: {
          added_at?: string;
          domain: string;
          source?: string;
        };
        Update: {
          added_at?: string;
          domain?: string;
          source?: string;
        };
        Relationships: [];
      };
      link_reports: {
        Row: {
          code: string;
          created_at: string;
          details: string | null;
          id: string;
          reason: "phishing" | "malware" | "spam" | "illegal" | "other";
          reporter_hash: string;
          status: "open" | "reviewed" | "actioned" | "dismissed";
        };
        Insert: {
          code: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason: "phishing" | "malware" | "spam" | "illegal" | "other";
          reporter_hash: string;
          status?: "open" | "reviewed" | "actioned" | "dismissed";
        };
        Update: {
          code?: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason?: "phishing" | "malware" | "spam" | "illegal" | "other";
          reporter_hash?: string;
          status?: "open" | "reviewed" | "actioned" | "dismissed";
        };
        Relationships: [
          {
            foreignKeyName: "link_reports_code_fkey";
            columns: ["code"];
            isOneToOne: false;
            referencedRelation: "short_links";
            referencedColumns: ["code"];
          },
        ];
      };
      rate_limits: {
        Row: {
          count: number;
          key: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          key: string;
          window_start: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      short_links: {
        Row: {
          clicks: number;
          code: string;
          created_at: string;
          creator_token_hash: string | null;
          expires_at: string | null;
          last_clicked_at: string | null;
          password_hash: string | null;
          status: "active" | "disabled" | "blocked" | "pending_review";
          target_host: string | null;
          updated_at: string | null;
          url: string;
        };
        Insert: {
          clicks?: number;
          code: string;
          created_at?: string;
          creator_token_hash?: string | null;
          expires_at?: string | null;
          last_clicked_at?: string | null;
          password_hash?: string | null;
          status?: "active" | "disabled" | "blocked" | "pending_review";
          target_host?: string | null;
          updated_at?: string | null;
          url: string;
        };
        Update: {
          clicks?: number;
          code?: string;
          created_at?: string;
          creator_token_hash?: string | null;
          expires_at?: string | null;
          last_clicked_at?: string | null;
          password_hash?: string | null;
          status?: "active" | "disabled" | "blocked" | "pending_review";
          target_host?: string | null;
          updated_at?: string | null;
          url?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_restore_link: {
        Args: {
          p_code: string;
        };
        Returns: undefined;
      };
      cleanup_rate_limits: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      rate_limit_hit: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          retry_after: number;
        }[];
      };
      register_click: {
        Args: {
          p_code: string;
        };
        Returns: undefined;
      };
      submit_link_report: {
        Args: {
          p_code: string;
          p_details?: string | null;
          p_reason: string;
          p_reporter_hash: string;
        };
        Returns: {
          already_reported: boolean;
          escalated: boolean;
          ok: boolean;
        }[];
      };
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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
