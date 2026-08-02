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
          role_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_email: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          invited_by?: string | null
          role_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_email?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          invited_by?: string | null
          role_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_activity_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_role: string | null
          actor_user_id: string | null
          area: string | null
          created_at: string
          id: string
          reason: string | null
          reference: string | null
          success: boolean
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          area?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          reference?: string | null
          success?: boolean
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          area?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          reference?: string | null
          success?: boolean
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_alert_log: {
        Row: {
          alert_key: string
          alert_type: string
          id: string
          recipient: string
          resolved_at: string | null
          sent_at: string
          subject: string
        }
        Insert: {
          alert_key: string
          alert_type: string
          id?: string
          recipient: string
          resolved_at?: string | null
          sent_at?: string
          subject: string
        }
        Update: {
          alert_key?: string
          alert_type?: string
          id?: string
          recipient?: string
          resolved_at?: string | null
          sent_at?: string
          subject?: string
        }
        Relationships: []
      }
      admin_invitations: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          created_at: string
          email: string
          expires_at: string | null
          id: string
          invited_by: string | null
          role_key: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          role_key?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          role_key?: string | null
          status?: string
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          granted: boolean
          permission: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          granted: boolean
          permission: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          granted?: boolean
          permission?: string
          updated_at?: string
          updated_by?: string | null
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
      consent_choices: {
        Row: {
          analytics: boolean
          created_at: string
          decided_at: string | null
          essential: boolean
          id: string
          marketing: boolean
          updated_at: string
          user_id: string | null
          visitor_id: string
        }
        Insert: {
          analytics?: boolean
          created_at?: string
          decided_at?: string | null
          essential?: boolean
          id?: string
          marketing?: boolean
          updated_at?: string
          user_id?: string | null
          visitor_id: string
        }
        Update: {
          analytics?: boolean
          created_at?: string
          decided_at?: string | null
          essential?: boolean
          id?: string
          marketing?: boolean
          updated_at?: string
          user_id?: string | null
          visitor_id?: string
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
      coupon_redemptions: {
        Row: {
          base_amount_ngn: number | null
          coupon_code: string
          coupon_id: string
          created_at: string
          discount_amount_ngn: number
          final_amount: number | null
          id: string
          order_id: string
          payment_currency: string | null
          paystack_reference: string | null
          user_id: string
        }
        Insert: {
          base_amount_ngn?: number | null
          coupon_code: string
          coupon_id: string
          created_at?: string
          discount_amount_ngn?: number
          final_amount?: number | null
          id?: string
          order_id: string
          payment_currency?: string | null
          paystack_reference?: string | null
          user_id: string
        }
        Update: {
          base_amount_ngn?: number | null
          coupon_code?: string
          coupon_id?: string
          created_at?: string
          discount_amount_ngn?: number
          final_amount?: number | null
          id?: string
          order_id?: string
          payment_currency?: string | null
          paystack_reference?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          access_type: string | null
          billing_period: string | null
          code: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          discount_type: string
          discount_value: number
          ends_at: string | null
          id: string
          is_active: boolean
          max_per_user: number
          max_redemptions: number | null
          min_amount_ngn: number | null
          redemptions_count: number
          starts_at: string | null
          tool_slug: string | null
          updated_at: string
        }
        Insert: {
          access_type?: string | null
          billing_period?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          discount_type?: string
          discount_value: number
          ends_at?: string | null
          id?: string
          is_active?: boolean
          max_per_user?: number
          max_redemptions?: number | null
          min_amount_ngn?: number | null
          redemptions_count?: number
          starts_at?: string | null
          tool_slug?: string | null
          updated_at?: string
        }
        Update: {
          access_type?: string | null
          billing_period?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          ends_at?: string | null
          id?: string
          is_active?: boolean
          max_per_user?: number
          max_redemptions?: number | null
          min_amount_ngn?: number | null
          redemptions_count?: number
          starts_at?: string | null
          tool_slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      currency_settings: {
        Row: {
          created_at: string
          id: boolean
          merchant_currencies: string[]
          supported_currencies: string[]
          surcharge_enabled: boolean
          surcharge_percent: number
          switching_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: boolean
          merchant_currencies?: string[]
          supported_currencies?: string[]
          surcharge_enabled?: boolean
          surcharge_percent?: number
          switching_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: boolean
          merchant_currencies?: string[]
          supported_currencies?: string[]
          surcharge_enabled?: boolean
          surcharge_percent?: number
          switching_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
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
          brand_color: string
          brand_logo_url: string | null
          brand_name: string
          created_at: string
          enabled_types: Json
          footer_company: string
          footer_message: string
          footer_support_email: string
          footer_website_url: string
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
          brand_color?: string
          brand_logo_url?: string | null
          brand_name?: string
          created_at?: string
          enabled_types?: Json
          footer_company?: string
          footer_message?: string
          footer_support_email?: string
          footer_website_url?: string
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
          brand_color?: string
          brand_logo_url?: string | null
          brand_name?: string
          created_at?: string
          enabled_types?: Json
          footer_company?: string
          footer_message?: string
          footer_support_email?: string
          footer_website_url?: string
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
      exchange_rate_logs: {
        Row: {
          base_currency: string
          created_at: string
          fetched_at: string
          id: string
          quote_currency: string
          rate: number
          source: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          fetched_at?: string
          id?: string
          quote_currency: string
          rate: number
          source: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          fetched_at?: string
          id?: string
          quote_currency?: string
          rate?: number
          source?: string
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          base_currency: string
          created_at: string
          expires_at: string
          fetched_at: string
          id: string
          quote_currency: string
          rate: number
          source: string
          updated_at: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          quote_currency: string
          rate: number
          source?: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          quote_currency?: string
          rate?: number
          source?: string
          updated_at?: string
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
      marketing_attribution: {
        Row: {
          fbclid: string | null
          first_seen_at: string
          first_touch: Json | null
          gclid: string | null
          id: string
          landing_page: string | null
          last_seen_at: string
          last_touch: Json | null
          referrer: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          fbclid?: string | null
          first_seen_at?: string
          first_touch?: Json | null
          gclid?: string | null
          id?: string
          landing_page?: string | null
          last_seen_at?: string
          last_touch?: Json | null
          referrer?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          fbclid?: string | null
          first_seen_at?: string
          first_touch?: Json | null
          gclid?: string | null
          id?: string
          landing_page?: string | null
          last_seen_at?: string
          last_touch?: Json | null
          referrer?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: []
      }
      marketing_events: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          error_message: string | null
          event_id: string | null
          event_name: string
          id: string
          order_id: string | null
          payload: Json
          platform: string
          source: string
          status: string
          tool_slug: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          event_id?: string | null
          event_name: string
          id?: string
          order_id?: string | null
          payload?: Json
          platform: string
          source: string
          status: string
          tool_slug?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          event_id?: string | null
          event_name?: string
          id?: string
          order_id?: string | null
          payload?: Json
          platform?: string
          source?: string
          status?: string
          tool_slug?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "tool_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_integrations: {
        Row: {
          config: Json
          connected: boolean
          created_at: string
          enabled: boolean
          id: string
          last_error_at: string | null
          last_error_message: string | null
          last_event_at: string | null
          last_event_name: string | null
          provider: string
          public_id: string | null
          test_event_code: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          connected?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_event_at?: string | null
          last_event_name?: string | null
          provider: string
          public_id?: string | null
          test_event_code?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          connected?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_event_at?: string | null
          last_event_name?: string | null
          provider?: string
          public_id?: string | null
          test_event_code?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_providers: {
        Row: {
          config: Json
          created_at: string
          display_name: string
          enabled: boolean
          environment: string
          id: string
          is_active: boolean
          last_test_at: string | null
          last_test_message: string | null
          last_test_status: string | null
          public_key: string | null
          slug: string
          updated_at: string
          webhook_secret_hint: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          display_name: string
          enabled?: boolean
          environment?: string
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_status?: string | null
          public_key?: string | null
          slug: string
          updated_at?: string
          webhook_secret_hint?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          display_name?: string
          enabled?: boolean
          environment?: string
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_status?: string | null
          public_key?: string | null
          slug?: string
          updated_at?: string
          webhook_secret_hint?: string | null
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
          subscription_currency: string
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
          subscription_currency?: string
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
          subscription_currency?: string
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
          gateway: string
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
          gateway?: string
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
          gateway?: string
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
      promotions: {
        Row: {
          audience: string
          created_at: string
          description: string | null
          discount_type: string | null
          discount_value: number | null
          ends_at: string | null
          id: string
          is_active: boolean
          starts_at: string | null
          title: string
          tool_slug: string | null
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          description?: string | null
          discount_type?: string | null
          discount_value?: number | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          starts_at?: string | null
          title: string
          tool_slug?: string | null
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          description?: string | null
          discount_type?: string | null
          discount_value?: number | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          starts_at?: string | null
          title?: string
          tool_slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          active_theme: string
          admin_whatsapp_number: string | null
          alert_almost_full_pct: number
          alert_email_recipients: string[]
          alert_emails_enabled: boolean
          alert_expiry_days: number
          emails_paused: boolean
          id: boolean
          maintenance_mode: boolean
          marketing_pause: boolean
          orders_paused: boolean
          payments_paused: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_theme?: string
          admin_whatsapp_number?: string | null
          alert_almost_full_pct?: number
          alert_email_recipients?: string[]
          alert_emails_enabled?: boolean
          alert_expiry_days?: number
          emails_paused?: boolean
          id?: boolean
          maintenance_mode?: boolean
          marketing_pause?: boolean
          orders_paused?: boolean
          payments_paused?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_theme?: string
          admin_whatsapp_number?: string | null
          alert_almost_full_pct?: number
          alert_email_recipients?: string[]
          alert_emails_enabled?: boolean
          alert_expiry_days?: number
          emails_paused?: boolean
          id?: boolean
          maintenance_mode?: boolean
          marketing_pause?: boolean
          orders_paused?: boolean
          payments_paused?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tool_account_assignments: {
        Row: {
          access_type: string
          account_id: string
          assigned_at: string
          assigned_by: string | null
          created_at: string
          id: string
          order_id: string | null
          released_at: string | null
          released_reason: string | null
          status: string
          tool_slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_type: string
          account_id: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          released_at?: string | null
          released_reason?: string | null
          status?: string
          tool_slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_type?: string
          account_id?: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          released_at?: string | null
          released_reason?: string | null
          status?: string
          tool_slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_account_assignments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tool_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_account_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "tool_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_account_audit: {
        Row: {
          account_id: string | null
          action: string
          actor: string | null
          created_at: string
          from_account_id: string | null
          id: string
          notes: string | null
          order_id: string | null
          to_account_id: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          action: string
          actor?: string | null
          created_at?: string
          from_account_id?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          to_account_id?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          action?: string
          actor?: string | null
          created_at?: string
          from_account_id?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          to_account_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tool_account_audit_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tool_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_account_audit_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "tool_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_account_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "tool_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_account_audit_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "tool_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_accounts: {
        Row: {
          access_type: string
          created_at: string
          created_by: string | null
          enabled: boolean
          expires_at: string | null
          id: string
          label: string
          last_health_check_at: string | null
          last_health_check_by: string | null
          last_health_check_note: string | null
          login_email: string | null
          login_notes: string | null
          login_password: string | null
          login_url: string | null
          max_capacity: number
          needs_capacity_review: boolean
          one_click_login_url: string | null
          status: string
          tool_slug: string
          updated_at: string
        }
        Insert: {
          access_type: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          id?: string
          label?: string
          last_health_check_at?: string | null
          last_health_check_by?: string | null
          last_health_check_note?: string | null
          login_email?: string | null
          login_notes?: string | null
          login_password?: string | null
          login_url?: string | null
          max_capacity?: number
          needs_capacity_review?: boolean
          one_click_login_url?: string | null
          status?: string
          tool_slug: string
          updated_at?: string
        }
        Update: {
          access_type?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          id?: string
          label?: string
          last_health_check_at?: string | null
          last_health_check_by?: string | null
          last_health_check_note?: string | null
          login_email?: string | null
          login_notes?: string | null
          login_password?: string | null
          login_url?: string | null
          max_capacity?: number
          needs_capacity_review?: boolean
          one_click_login_url?: string | null
          status?: string
          tool_slug?: string
          updated_at?: string
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
          attribution: Json | null
          auto_fulfilled_at: string | null
          billing_period: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          coupon_code: string | null
          coupon_id: string | null
          created_at: string
          created_by_admin: string | null
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          discount_amount_ngn: number
          discounted_amount_ngn: number | null
          display_amount: number | null
          display_currency: string | null
          duration_days: number | null
          exchange_rate_snapshot: number | null
          expires_at: string | null
          final_amount_charged: number | null
          fulfilled_at: string | null
          fulfilment_deadline_at: string | null
          fulfilment_marked_by: string | null
          fulfilment_reason: string | null
          fulfilment_status: string
          gateway_response: Json | null
          gateway_transaction_reference: string | null
          grace_days: number
          id: string
          international_fee_amount: number
          next_payment_at: string | null
          non_renewal_requested_at: string | null
          notes: string | null
          origin: string
          paid_at: string | null
          paid_through_at: string | null
          payment_currency: string
          payment_gateway: string
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
          attribution?: Json | null
          auto_fulfilled_at?: string | null
          billing_period?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          created_by_admin?: string | null
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          discount_amount_ngn?: number
          discounted_amount_ngn?: number | null
          display_amount?: number | null
          display_currency?: string | null
          duration_days?: number | null
          exchange_rate_snapshot?: number | null
          expires_at?: string | null
          final_amount_charged?: number | null
          fulfilled_at?: string | null
          fulfilment_deadline_at?: string | null
          fulfilment_marked_by?: string | null
          fulfilment_reason?: string | null
          fulfilment_status?: string
          gateway_response?: Json | null
          gateway_transaction_reference?: string | null
          grace_days?: number
          id?: string
          international_fee_amount?: number
          next_payment_at?: string | null
          non_renewal_requested_at?: string | null
          notes?: string | null
          origin?: string
          paid_at?: string | null
          paid_through_at?: string | null
          payment_currency?: string
          payment_gateway?: string
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
          attribution?: Json | null
          auto_fulfilled_at?: string | null
          billing_period?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          created_by_admin?: string | null
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          discount_amount_ngn?: number
          discounted_amount_ngn?: number | null
          display_amount?: number | null
          display_currency?: string | null
          duration_days?: number | null
          exchange_rate_snapshot?: number | null
          expires_at?: string | null
          final_amount_charged?: number | null
          fulfilled_at?: string | null
          fulfilment_deadline_at?: string | null
          fulfilment_marked_by?: string | null
          fulfilment_reason?: string | null
          fulfilment_status?: string
          gateway_response?: Json | null
          gateway_transaction_reference?: string | null
          grace_days?: number
          id?: string
          international_fee_amount?: number
          next_payment_at?: string | null
          non_renewal_requested_at?: string | null
          notes?: string | null
          origin?: string
          paid_at?: string | null
          paid_through_at?: string | null
          payment_currency?: string
          payment_gateway?: string
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
      tool_overrides: {
        Row: {
          access: string | null
          category: string | null
          created_at: string
          description: string | null
          domain: string | null
          featured: boolean
          features: Json | null
          image_url: string | null
          is_custom: boolean
          is_visible: boolean
          name: string | null
          tagline: string | null
          tool_slug: string
          updated_at: string
        }
        Insert: {
          access?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          featured?: boolean
          features?: Json | null
          image_url?: string | null
          is_custom?: boolean
          is_visible?: boolean
          name?: string | null
          tagline?: string | null
          tool_slug: string
          updated_at?: string
        }
        Update: {
          access?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          featured?: boolean
          features?: Json | null
          image_url?: string | null
          is_custom?: boolean
          is_visible?: boolean
          name?: string | null
          tagline?: string | null
          tool_slug?: string
          updated_at?: string
        }
        Relationships: []
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
          base_amount_ngn: number | null
          billing_period: string | null
          classification: string
          converted_amount: number | null
          coupon_code: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          discount_amount_ngn: number
          display_amount: number | null
          display_currency: string | null
          exchange_rate: number | null
          final_amount: number | null
          flagged_at: string | null
          flagged_reason: string | null
          gateway_response: Json | null
          gateway_transaction_reference: string | null
          id: string
          initiated_at: string
          international_fee_amount: number
          international_fee_percent: number
          last_status_change_at: string | null
          order_id: string | null
          paid_at: string | null
          payment_channel: string | null
          payment_currency: string
          payment_gateway: string
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
          base_amount_ngn?: number | null
          billing_period?: string | null
          classification?: string
          converted_amount?: number | null
          coupon_code?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          discount_amount_ngn?: number
          display_amount?: number | null
          display_currency?: string | null
          exchange_rate?: number | null
          final_amount?: number | null
          flagged_at?: string | null
          flagged_reason?: string | null
          gateway_response?: Json | null
          gateway_transaction_reference?: string | null
          id?: string
          initiated_at?: string
          international_fee_amount?: number
          international_fee_percent?: number
          last_status_change_at?: string | null
          order_id?: string | null
          paid_at?: string | null
          payment_channel?: string | null
          payment_currency?: string
          payment_gateway?: string
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
          base_amount_ngn?: number | null
          billing_period?: string | null
          classification?: string
          converted_amount?: number | null
          coupon_code?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          discount_amount_ngn?: number
          display_amount?: number | null
          display_currency?: string | null
          exchange_rate?: number | null
          final_amount?: number | null
          flagged_at?: string | null
          flagged_reason?: string | null
          gateway_response?: Json | null
          gateway_transaction_reference?: string | null
          id?: string
          initiated_at?: string
          international_fee_amount?: number
          international_fee_percent?: number
          last_status_change_at?: string | null
          order_id?: string | null
          paid_at?: string | null
          payment_channel?: string | null
          payment_currency?: string
          payment_gateway?: string
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
      tool_review_versions: {
        Row: {
          body: string
          created_at: string
          display_name: string | null
          id: string
          qualifying_order_id: string | null
          rating: number
          review_id: string
          status: Database["public"]["Enums"]["review_status"]
          submitted_at: string
          title: string
          tool_slug: string
          user_id: string
          version_no: number
        }
        Insert: {
          body: string
          created_at?: string
          display_name?: string | null
          id?: string
          qualifying_order_id?: string | null
          rating: number
          review_id: string
          status: Database["public"]["Enums"]["review_status"]
          submitted_at: string
          title: string
          tool_slug: string
          user_id: string
          version_no: number
        }
        Update: {
          body?: string
          created_at?: string
          display_name?: string | null
          id?: string
          qualifying_order_id?: string | null
          rating?: number
          review_id?: string
          status?: Database["public"]["Enums"]["review_status"]
          submitted_at?: string
          title?: string
          tool_slug?: string
          user_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "tool_review_versions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "tool_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_reviews: {
        Row: {
          body: string
          created_at: string
          display_name: string | null
          id: string
          moderation_note: string | null
          qualifying_order_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          submitted_at: string
          title: string
          tool_slug: string
          updated_at: string
          user_id: string
          verified_source: Database["public"]["Enums"]["review_source"]
          version_no: number
        }
        Insert: {
          body: string
          created_at?: string
          display_name?: string | null
          id?: string
          moderation_note?: string | null
          qualifying_order_id?: string | null
          rating: number
          status?: Database["public"]["Enums"]["review_status"]
          submitted_at?: string
          title: string
          tool_slug: string
          updated_at?: string
          user_id: string
          verified_source: Database["public"]["Enums"]["review_source"]
          version_no?: number
        }
        Update: {
          body?: string
          created_at?: string
          display_name?: string | null
          id?: string
          moderation_note?: string | null
          qualifying_order_id?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["review_status"]
          submitted_at?: string
          title?: string
          tool_slug?: string
          updated_at?: string
          user_id?: string
          verified_source?: Database["public"]["Enums"]["review_source"]
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "tool_reviews_qualifying_order_id_fkey"
            columns: ["qualifying_order_id"]
            isOneToOne: false
            referencedRelation: "tool_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_settings: {
        Row: {
          access_level: Database["public"]["Enums"]["tool_access_level"]
          auth_provider: string | null
          display_manual_credentials: boolean
          enabled: boolean
          full_pool_policy: string
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
          full_pool_policy?: string
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
          full_pool_policy?: string
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
          renewal_currency: string
          status: string
          subscription_currency: string
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
          renewal_currency?: string
          status?: string
          subscription_currency?: string
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
          renewal_currency?: string
          status?: string
          subscription_currency?: string
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
      admin_effective_permission: {
        Args: { _perm: string; _uid: string }
        Returns: boolean
      }
      assign_tool_account_for_order: {
        Args: { _order_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      record_coupon_redemption: {
        Args: { _order_id: string; _paystack_reference?: string }
        Returns: boolean
      }
      release_assignments_for_order: {
        Args: { _order_id: string; _reason: string }
        Returns: number
      }
      user_has_tool_access: {
        Args: { _slug: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      blog_post_status: "draft" | "scheduled" | "published" | "archived"
      review_source: "paystack" | "offline"
      review_status: "pending" | "approved" | "rejected" | "hidden"
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
      review_source: ["paystack", "offline"],
      review_status: ["pending", "approved", "rejected", "hidden"],
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
