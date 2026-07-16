export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          subject?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          notification_email: boolean
          notification_product: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          notification_email?: boolean
          notification_product?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          notification_email?: boolean
          notification_product?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          active_theme: string
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_theme?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_theme?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tool_orders: {
        Row: {
          admin_notes: string | null
          approved_at: string | null
          created_at: string
          currency: string
          duration_days: number | null
          expires_at: string | null
          grace_days: number
          id: string
          notes: string | null
          paid_at: string | null
          paystack_reference: string | null
          price_amount: number | null
          price_label: string | null
          pricing_option_id: string | null
          status: Database["public"]["Enums"]["tool_order_status"]
          tool_slug: string
          updated_at: string
          user_id: string
          warning_days: number
        }
        Insert: {
          admin_notes?: string | null
          approved_at?: string | null
          created_at?: string
          currency?: string
          duration_days?: number | null
          expires_at?: string | null
          grace_days?: number
          id?: string
          notes?: string | null
          paid_at?: string | null
          paystack_reference?: string | null
          price_amount?: number | null
          price_label?: string | null
          pricing_option_id?: string | null
          status?: Database["public"]["Enums"]["tool_order_status"]
          tool_slug: string
          updated_at?: string
          user_id: string
          warning_days?: number
        }
        Update: {
          admin_notes?: string | null
          approved_at?: string | null
          created_at?: string
          currency?: string
          duration_days?: number | null
          expires_at?: string | null
          grace_days?: number
          id?: string
          notes?: string | null
          paid_at?: string | null
          paystack_reference?: string | null
          price_amount?: number | null
          price_label?: string | null
          pricing_option_id?: string | null
          status?: Database["public"]["Enums"]["tool_order_status"]
          tool_slug?: string
          updated_at?: string
          user_id?: string
          warning_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "tool_orders_pricing_option_id_fkey"
            columns: ["pricing_option_id"]
            isOneToOne: false
            referencedRelation: "tool_pricing"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_pricing: {
        Row: {
          amount: number | null
          contact_admin: boolean
          created_at: string
          currency: string
          duration_days: number | null
          grace_days: number
          id: string
          label: string | null
          sort_order: number
          tool_slug: string
          unit: string | null
          updated_at: string
          warning_days: number
        }
        Insert: {
          amount?: number | null
          contact_admin?: boolean
          created_at?: string
          currency?: string
          duration_days?: number | null
          grace_days?: number
          id?: string
          label?: string | null
          sort_order?: number
          tool_slug: string
          unit?: string | null
          updated_at?: string
          warning_days?: number
        }
        Update: {
          amount?: number | null
          contact_admin?: boolean
          created_at?: string
          currency?: string
          duration_days?: number | null
          grace_days?: number
          id?: string
          label?: string | null
          sort_order?: number
          tool_slug?: string
          unit?: string | null
          updated_at?: string
          warning_days?: number
        }
        Relationships: []
      }
      tool_settings: {
        Row: {
          access_level: Database["public"]["Enums"]["tool_access_level"]
          enabled: boolean
          login_email: string | null
          login_notes: string | null
          login_password: string | null
          login_url: string | null
          tool_slug: string
          updated_at: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["tool_access_level"]
          enabled?: boolean
          login_email?: string | null
          login_notes?: string | null
          login_password?: string | null
          login_url?: string | null
          tool_slug: string
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["tool_access_level"]
          enabled?: boolean
          login_email?: string | null
          login_notes?: string | null
          login_password?: string | null
          login_url?: string | null
          tool_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      tool_usage: {
        Row: {
          id: string
          tool_slug: string
          used_at: string
          user_id: string
        }
        Insert: {
          id?: string
          tool_slug: string
          used_at?: string
          user_id: string
        }
        Update: {
          id?: string
          tool_slug?: string
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_favorites: {
        Row: {
          created_at: string
          tool_slug: string
          user_id: string
        }
        Insert: {
          created_at?: string
          tool_slug: string
          user_id: string
        }
        Update: {
          created_at?: string
          tool_slug?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          interval: string | null
          plan: string
          status: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          interval?: string | null
          plan?: string
          status?: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          interval?: string | null
          plan?: string
          status?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      user_has_tool_access: {
        Args: { _slug: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      tool_access_level: "public" | "logged_in" | "purchased"
      tool_order_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      tool_access_level: ["public", "logged_in", "purchased"],
      tool_order_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ],
    },
  },
} as const
