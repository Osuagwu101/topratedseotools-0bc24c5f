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
      admin_accounts: {
        Row: {
          account_email: string
          created_at: string
          email: string | null
          full_name: string | null
          invited_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_email: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          invited_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_email?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          invited_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_generator_settings: {
        Row: {
          brand_description: string
          brand_name: string
          brand_url: string
          brand_voice: string | null
          created_at: string
          default_audience: string
          default_country: string | null
          default_language: string
          default_length: string
          default_reading_level: string
          default_tone: string
          default_writing_style: string
          id: string
          model: string
          promo_enabled: boolean
          promo_position: number
          promo_tone: string
          provider: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          brand_description?: string
          brand_name?: string
          brand_url?: string
          brand_voice?: string | null
          created_at?: string
          default_audience?: string
          default_country?: string | null
          default_language?: string
          default_length?: string
          default_reading_level?: string
          default_tone?: string
          default_writing_style?: string
          id?: string
          model?: string
          promo_enabled?: boolean
          promo_position?: number
          promo_tone?: string
          provider?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          brand_description?: string
          brand_name?: string
          brand_url?: string
          brand_voice?: string | null
          created_at?: string
          default_audience?: string
          default_country?: string | null
          default_language?: string
          default_length?: string
          default_reading_level?: string
          default_tone?: string
          default_writing_style?: string
          id?: string
          model?: string
          promo_enabled?: boolean
          promo_position?: number
          promo_tone?: string
          provider?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      blog_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      blog_comments: {
        Row: {
          author_email: string
          author_name: string
          content: string
          created_at: string
          id: string
          post_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          author_email: string
          author_name: string
          content: string
          created_at?: string
          id?: string
          post_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          author_email?: string
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_cta_templates: {
        Row: {
          body: string
          button_label: string
          button_url: string
          created_at: string
          enabled: boolean
          id: string
          is_default: boolean
          name: string
          priority: number
          target_category_slugs: string[]
          target_tool_slugs: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          button_label: string
          button_url: string
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          name: string
          priority?: number
          target_category_slugs?: string[]
          target_tool_slugs?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          button_label?: string
          button_url?: string
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          name?: string
          priority?: number
          target_category_slugs?: string[]
          target_tool_slugs?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      blog_post_tags: {
        Row: {
          post_id: string
          tag_id: string
        }
        Insert: {
          post_id: string
          tag_id: string
        }
        Update: {
          post_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_post_tags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_post_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "blog_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author_id: string | null
          canonical_url: string | null
          category_id: string | null
          content: string
          created_at: string
          cta_template_id: string | null
          excerpt: string | null
          faq: Json
          featured_image: string | null
          featured_image_alt: string | null
          featured_image_credit: string | null
          featured_image_source: string | null
          id: string
          image_alts: Json
          is_featured: boolean
          og_description: string | null
          og_image: string | null
          og_title: string | null
          published_at: string | null
          reading_time_minutes: number
          scheduled_for: string | null
          semantic_keywords: string[]
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["blog_post_status"]
          subtitle: string | null
          title: string
          twitter_description: string | null
          twitter_image: string | null
          twitter_title: string | null
          updated_at: string
          view_count: number
        }
        Insert: {
          author_id?: string | null
          canonical_url?: string | null
          category_id?: string | null
          content?: string
          created_at?: string
          cta_template_id?: string | null
          excerpt?: string | null
          faq?: Json
          featured_image?: string | null
          featured_image_alt?: string | null
          featured_image_credit?: string | null
          featured_image_source?: string | null
          id?: string
          image_alts?: Json
          is_featured?: boolean
          og_description?: string | null
          og_image?: string | null
          og_title?: string | null
          published_at?: string | null
          reading_time_minutes?: number
          scheduled_for?: string | null
          semantic_keywords?: string[]
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["blog_post_status"]
          subtitle?: string | null
          title: string
          twitter_description?: string | null
          twitter_image?: string | null
          twitter_title?: string | null
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_id?: string | null
          canonical_url?: string | null
          category_id?: string | null
          content?: string
          created_at?: string
          cta_template_id?: string | null
          excerpt?: string | null
          faq?: Json
          featured_image?: string | null
          featured_image_alt?: string | null
          featured_image_credit?: string | null
          featured_image_source?: string | null
          id?: string
          image_alts?: Json
          is_featured?: boolean
          og_description?: string | null
          og_image?: string | null
          og_title?: string | null
          published_at?: string | null
          reading_time_minutes?: number
          scheduled_for?: string | null
          semantic_keywords?: string[]
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["blog_post_status"]
          subtitle?: string | null
          title?: string
          twitter_description?: string | null
          twitter_image?: string | null
          twitter_title?: string | null
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_revisions: {
        Row: {
          content: string
          created_at: string
          edited_by: string | null
          excerpt: string | null
          featured_image: string | null
          id: string
          post_id: string
          subtitle: string | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          edited_by?: string | null
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          post_id: string
          subtitle?: string | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          edited_by?: string | null
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          post_id?: string
          subtitle?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_revisions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_settings: {
        Row: {
          ai_image_model: string | null
          comments_enabled: boolean
          created_at: string
          default_image_provider: string | null
          hero_subtitle: string
          hero_title: string
          id: string
          keyword_highlight_color: string
          keyword_highlight_enabled: boolean
          posts_per_page: number
          updated_at: string
        }
        Insert: {
          ai_image_model?: string | null
          comments_enabled?: boolean
          created_at?: string
          default_image_provider?: string | null
          hero_subtitle?: string
          hero_title?: string
          id?: string
          keyword_highlight_color?: string
          keyword_highlight_enabled?: boolean
          posts_per_page?: number
          updated_at?: string
        }
        Update: {
          ai_image_model?: string | null
          comments_enabled?: boolean
          created_at?: string
          default_image_provider?: string | null
          hero_subtitle?: string
          hero_title?: string
          id?: string
          keyword_highlight_color?: string
          keyword_highlight_enabled?: boolean
          posts_per_page?: number
          updated_at?: string
        }
        Relationships: []
      }
      blog_tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
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
      customer_admin_audit: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          customer_id: string
          details: Json | null
          id: string
          order_id: string | null
          payment_id: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          customer_id: string
          details?: Json | null
          id?: string
          order_id?: string | null
          payment_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string
          customer_id?: string
          details?: Json | null
          id?: string
          order_id?: string | null
          payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_admin_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "tool_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_admin_audit_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "tool_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_admin_meta: {
        Row: {
          admin_notes: string | null
          created_at: string
          phone: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      email_messages: {
        Row: {
          attempts: number
          created_at: string
          event_key: string
          id: string
          last_error: string | null
          payload: Json
          recipient: string
          related_order_id: string | null
          related_user_id: string | null
          resend_message_id: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          subject: string | null
          template_key: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_key: string
          id?: string
          last_error?: string | null
          payload?: Json
          recipient: string
          related_order_id?: string | null
          related_user_id?: string | null
          resend_message_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_key: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_key?: string
          id?: string
          last_error?: string | null
          payload?: Json
          recipient?: string
          related_order_id?: string | null
          related_user_id?: string | null
          resend_message_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          abandoned_delay_hours: number
          created_at: string
          enabled_types: Json
          from_email: string
          id: boolean
          last_verified_at: string | null
          production_sending: boolean
          reply_to_email: string
          resend_dns_records: Json | null
          resend_domain_id: string | null
          resend_domain_status: string
          sender_name: string
          sending_domain: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          abandoned_delay_hours?: number
          created_at?: string
          enabled_types?: Json
          from_email?: string
          id?: boolean
          last_verified_at?: string | null
          production_sending?: boolean
          reply_to_email?: string
          resend_dns_records?: Json | null
          resend_domain_id?: string | null
          resend_domain_status?: string
          sender_name?: string
          sending_domain?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          abandoned_delay_hours?: number
          created_at?: string
          enabled_types?: Json
          from_email?: string
          id?: boolean
          last_verified_at?: string | null
          production_sending?: boolean
          reply_to_email?: string
          resend_dns_records?: Json | null
          resend_domain_id?: string | null
          resend_domain_status?: string
          sender_name?: string
          sending_domain?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          created_at: string
          enabled: boolean
          html_body: string
          id: string
          is_system: boolean
          key: string
          name: string
          subject: string
          text_body: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          html_body: string
          id?: string
          is_system?: boolean
          key: string
          name: string
          subject: string
          text_body?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          html_body?: string
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          subject?: string
          text_body?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      internal_secrets: {
        Row: {
          name: string
          updated_at: string
          value: string
        }
        Insert: {
          name: string
          updated_at?: string
          value: string
        }
        Update: {
          name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      paystack_customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          paystack_customer_code: string
          paystack_environment: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          paystack_customer_code: string
          paystack_environment: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          paystack_customer_code?: string
          paystack_environment?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paystack_plan_mappings: {
        Row: {
          access_type: string
          active_for_new_purchases: boolean
          amount_snapshot: number | null
          billing_period: string
          created_at: string
          currency: string
          id: string
          last_verified_at: string | null
          paystack_environment: string
          paystack_interval: string | null
          paystack_plan_code: string | null
          pricing_option_id: string | null
          superseded_at: string | null
          sync_error: string | null
          sync_status: string
          tool_slug: string
          updated_at: string
        }
        Insert: {
          access_type: string
          active_for_new_purchases?: boolean
          amount_snapshot?: number | null
          billing_period: string
          created_at?: string
          currency?: string
          id?: string
          last_verified_at?: string | null
          paystack_environment: string
          paystack_interval?: string | null
          paystack_plan_code?: string | null
          pricing_option_id?: string | null
          superseded_at?: string | null
          sync_error?: string | null
          sync_status?: string
          tool_slug: string
          updated_at?: string
        }
        Update: {
          access_type?: string
          active_for_new_purchases?: boolean
          amount_snapshot?: number | null
          billing_period?: string
          created_at?: string
          currency?: string
          id?: string
          last_verified_at?: string | null
          paystack_environment?: string
          paystack_interval?: string | null
          paystack_plan_code?: string | null
          pricing_option_id?: string | null
          superseded_at?: string | null
          sync_error?: string | null
          sync_status?: string
          tool_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paystack_plan_mappings_pricing_option_id_fkey"
            columns: ["pricing_option_id"]
            isOneToOne: false
            referencedRelation: "tool_pricing"
            referencedColumns: ["id"]
          },
        ]
      }
      paystack_webhook_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          invoice_code: string | null
          last_error: string | null
          payload_hash: string | null
          paystack_environment: string
          processed_at: string | null
          processing_attempts: number
          processing_status: string
          received_at: string
          subscription_code: string | null
          transaction_reference: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          invoice_code?: string | null
          last_error?: string | null
          payload_hash?: string | null
          paystack_environment?: string
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: string
          received_at?: string
          subscription_code?: string | null
          transaction_reference?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          invoice_code?: string | null
          last_error?: string | null
          payload_hash?: string | null
          paystack_environment?: string
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: string
          received_at?: string
          subscription_code?: string | null
          transaction_reference?: string | null
          updated_at?: string
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
          must_change_password: boolean
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
          must_change_password?: boolean
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
          must_change_password?: boolean
          notification_email?: boolean
          notification_product?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          active_theme: string
          admin_whatsapp_number: string | null
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_theme?: string
          admin_whatsapp_number?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_theme?: string
          admin_whatsapp_number?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tool_credentials: {
        Row: {
          created_at: string
          login_email: string | null
          login_notes: string | null
          login_password: string | null
          login_url: string | null
          tool_slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          login_email?: string | null
          login_notes?: string | null
          login_password?: string | null
          login_url?: string | null
          tool_slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          login_email?: string | null
          login_notes?: string | null
          login_password?: string | null
          login_url?: string | null
          tool_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      tool_orders: {
        Row: {
          access_type: string | null
          admin_notes: string | null
          approved_at: string | null
          auto_fulfilled_at: string | null
          billing_period: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by_admin: string | null
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          duration_days: number | null
          expires_at: string | null
          fulfilled_at: string | null
          fulfilment_deadline_at: string | null
          fulfilment_marked_by: string | null
          fulfilment_reason: string | null
          fulfilment_status: string
          grace_days: number
          id: string
          next_payment_at: string | null
          non_renewal_requested_at: string | null
          notes: string | null
          origin: string
          paid_at: string | null
          paid_through_at: string | null
          payment_status: string
          payment_type: string
          paystack_customer_code: string | null
          paystack_environment: string
          paystack_plan_code: string | null
          paystack_reference: string | null
          paystack_subscription_code: string | null
          price_amount: number | null
          price_label: string | null
          pricing_option_id: string | null
          product_type: string
          quantity: number | null
          renewal_status: string
          service_status: string | null
          status: Database["public"]["Enums"]["tool_order_status"]
          subscription_disabled_at: string | null
          subscription_started_at: string | null
          subscription_status: string
          tool_slug: string
          unit_amount: number | null
          updated_at: string
          user_id: string
          verified_total: number | null
          warning_days: number
        }
        Insert: {
          access_type?: string | null
          admin_notes?: string | null
          approved_at?: string | null
          auto_fulfilled_at?: string | null
          billing_period?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by_admin?: string | null
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          duration_days?: number | null
          expires_at?: string | null
          fulfilled_at?: string | null
          fulfilment_deadline_at?: string | null
          fulfilment_marked_by?: string | null
          fulfilment_reason?: string | null
          fulfilment_status?: string
          grace_days?: number
          id?: string
          next_payment_at?: string | null
          non_renewal_requested_at?: string | null
          notes?: string | null
          origin?: string
          paid_at?: string | null
          paid_through_at?: string | null
          payment_status?: string
          payment_type?: string
          paystack_customer_code?: string | null
          paystack_environment?: string
          paystack_plan_code?: string | null
          paystack_reference?: string | null
          paystack_subscription_code?: string | null
          price_amount?: number | null
          price_label?: string | null
          pricing_option_id?: string | null
          product_type?: string
          quantity?: number | null
          renewal_status?: string
          service_status?: string | null
          status?: Database["public"]["Enums"]["tool_order_status"]
          subscription_disabled_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          tool_slug: string
          unit_amount?: number | null
          updated_at?: string
          user_id: string
          verified_total?: number | null
          warning_days?: number
        }
        Update: {
          access_type?: string | null
          admin_notes?: string | null
          approved_at?: string | null
          auto_fulfilled_at?: string | null
          billing_period?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by_admin?: string | null
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          duration_days?: number | null
          expires_at?: string | null
          fulfilled_at?: string | null
          fulfilment_deadline_at?: string | null
          fulfilment_marked_by?: string | null
          fulfilment_reason?: string | null
          fulfilment_status?: string
          grace_days?: number
          id?: string
          next_payment_at?: string | null
          non_renewal_requested_at?: string | null
          notes?: string | null
          origin?: string
          paid_at?: string | null
          paid_through_at?: string | null
          payment_status?: string
          payment_type?: string
          paystack_customer_code?: string | null
          paystack_environment?: string
          paystack_plan_code?: string | null
          paystack_reference?: string | null
          paystack_subscription_code?: string | null
          price_amount?: number | null
          price_label?: string | null
          pricing_option_id?: string | null
          product_type?: string
          quantity?: number | null
          renewal_status?: string
          service_status?: string | null
          status?: Database["public"]["Enums"]["tool_order_status"]
          subscription_disabled_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          tool_slug?: string
          unit_amount?: number | null
          updated_at?: string
          user_id?: string
          verified_total?: number | null
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
      tool_payment_status_history: {
        Row: {
          created_at: string
          created_by: string | null
          from_status: string | null
          id: string
          note: string | null
          payment_id: string
          paystack_status: string | null
          source: string
          to_status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_status?: string | null
          id?: string
          note?: string | null
          payment_id: string
          paystack_status?: string | null
          source: string
          to_status: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_status?: string | null
          id?: string
          note?: string | null
          payment_id?: string
          paystack_status?: string | null
          source?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_payment_status_history_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "tool_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_payments: {
        Row: {
          access_type: string | null
          admin_note: string | null
          amount: number | null
          billing_period: string | null
          classification: string
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          flagged_at: string | null
          flagged_reason: string | null
          id: string
          initiated_at: string
          last_status_change_at: string | null
          order_id: string | null
          paid_at: string | null
          payment_channel: string | null
          payment_method: string | null
          payment_status: string
          payment_type: string
          paystack_environment: string
          paystack_invoice_code: string | null
          paystack_last_checked_at: string | null
          paystack_reference: string | null
          paystack_status: string | null
          paystack_transaction_id: string | null
          price_label: string | null
          receipt_last_error: string | null
          receipt_last_status: string | null
          receipt_sent_at: string | null
          reconciliation_note: string | null
          reconciliation_status: string
          recorded_by: string | null
          reference_note: string | null
          source: string
          tool_slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_type?: string | null
          admin_note?: string | null
          amount?: number | null
          billing_period?: string | null
          classification?: string
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          flagged_at?: string | null
          flagged_reason?: string | null
          id?: string
          initiated_at?: string
          last_status_change_at?: string | null
          order_id?: string | null
          paid_at?: string | null
          payment_channel?: string | null
          payment_method?: string | null
          payment_status?: string
          payment_type?: string
          paystack_environment?: string
          paystack_invoice_code?: string | null
          paystack_last_checked_at?: string | null
          paystack_reference?: string | null
          paystack_status?: string | null
          paystack_transaction_id?: string | null
          price_label?: string | null
          receipt_last_error?: string | null
          receipt_last_status?: string | null
          receipt_sent_at?: string | null
          reconciliation_note?: string | null
          reconciliation_status?: string
          recorded_by?: string | null
          reference_note?: string | null
          source?: string
          tool_slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_type?: string | null
          admin_note?: string | null
          amount?: number | null
          billing_period?: string | null
          classification?: string
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          flagged_at?: string | null
          flagged_reason?: string | null
          id?: string
          initiated_at?: string
          last_status_change_at?: string | null
          order_id?: string | null
          paid_at?: string | null
          payment_channel?: string | null
          payment_method?: string | null
          payment_status?: string
          payment_type?: string
          paystack_environment?: string
          paystack_invoice_code?: string | null
          paystack_last_checked_at?: string | null
          paystack_reference?: string | null
          paystack_status?: string | null
          paystack_transaction_id?: string | null
          price_label?: string | null
          receipt_last_error?: string | null
          receipt_last_status?: string | null
          receipt_sent_at?: string | null
          reconciliation_note?: string | null
          reconciliation_status?: string
          recorded_by?: string | null
          reference_note?: string | null
          source?: string
          tool_slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "tool_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_pricing: {
        Row: {
          access_type: string
          amount: number | null
          badge: string | null
          billing_period: string | null
          contact_admin: boolean
          created_at: string
          currency: string
          duration_days: number | null
          enabled: boolean
          grace_days: number
          id: string
          label: string | null
          note: string | null
          paystack_plan_code: string | null
          sort_order: number
          tool_slug: string
          unit: string | null
          updated_at: string
          warning_days: number
        }
        Insert: {
          access_type?: string
          amount?: number | null
          badge?: string | null
          billing_period?: string | null
          contact_admin?: boolean
          created_at?: string
          currency?: string
          duration_days?: number | null
          enabled?: boolean
          grace_days?: number
          id?: string
          label?: string | null
          note?: string | null
          paystack_plan_code?: string | null
          sort_order?: number
          tool_slug: string
          unit?: string | null
          updated_at?: string
          warning_days?: number
        }
        Update: {
          access_type?: string
          amount?: number | null
          badge?: string | null
          billing_period?: string | null
          contact_admin?: boolean
          created_at?: string
          currency?: string
          duration_days?: number | null
          enabled?: boolean
          grace_days?: number
          id?: string
          label?: string | null
          note?: string | null
          paystack_plan_code?: string | null
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
          auth_provider: string | null
          display_manual_credentials: boolean
          enabled: boolean
          launch_mode: string
          official_login_url: string | null
          one_click_auth_enabled: boolean
          private_access_authorization: string
          private_access_enabled: boolean
          shared_access_authorization: string
          shared_access_enabled: boolean
          tool_slug: string
          updated_at: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["tool_access_level"]
          auth_provider?: string | null
          display_manual_credentials?: boolean
          enabled?: boolean
          launch_mode?: string
          official_login_url?: string | null
          one_click_auth_enabled?: boolean
          private_access_authorization?: string
          private_access_enabled?: boolean
          shared_access_authorization?: string
          shared_access_enabled?: boolean
          tool_slug: string
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["tool_access_level"]
          auth_provider?: string | null
          display_manual_credentials?: boolean
          enabled?: boolean
          launch_mode?: string
          official_login_url?: string | null
          one_click_auth_enabled?: boolean
          private_access_authorization?: string
          private_access_enabled?: boolean
          shared_access_authorization?: string
          shared_access_enabled?: boolean
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
          is_active: boolean
          is_super_admin: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_super_admin?: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_super_admin?: boolean
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
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      user_has_tool_access: {
        Args: { _slug: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      blog_post_status: "draft" | "scheduled" | "published" | "archived"
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
      blog_post_status: ["draft", "scheduled", "published", "archived"],
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
